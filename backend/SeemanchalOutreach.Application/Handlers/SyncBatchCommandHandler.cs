using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediatR;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Commands;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Application.Handlers
{
    public class SyncBatchCommandHandler : IRequestHandler<SyncBatchCommand, SyncBatchResponse>
    {
        private readonly IMarketingDbContext _db;
        private readonly IPhotoUploadService _photoUploadService;

        public SyncBatchCommandHandler(IMarketingDbContext db, IPhotoUploadService photoUploadService)
        {
            _db = db;
            _photoUploadService = photoUploadService;
        }

        // Contacts are captured offline-first, so a photo taken in the field is
        // stored as a base64 data URI on the local device (there's no guarantee
        // of a connection at capture time to hit the multipart /sync/photo
        // endpoint synchronously). This finishes that upload during sync instead,
        // once connectivity is actually available. If decoding/upload fails for
        // any reason, the rest of the contact still saves — a bad photo shouldn't
        // block the CRM data itself.
        private async Task<string?> TryUploadDataUriAsync(string? dataUri, CancellationToken cancellationToken)
        {
            if (string.IsNullOrEmpty(dataUri) || !dataUri.StartsWith("data:", StringComparison.Ordinal)) return null;

            try
            {
                int commaIdx = dataUri.IndexOf(',');
                if (commaIdx < 0) return null;

                string header = dataUri.Substring(5, commaIdx - 5); // strip "data:"
                string contentType = header.Split(';')[0];
                if (string.IsNullOrEmpty(contentType)) contentType = "application/octet-stream";

                byte[] bytes = Convert.FromBase64String(dataUri.Substring(commaIdx + 1));
                string extension = contentType switch
                {
                    "image/png" => "png",
                    "image/webp" => "webp",
                    "image/jpeg" => "jpg",
                    "application/pdf" => "pdf",
                    _ => "bin",
                };

                using var stream = new System.IO.MemoryStream(bytes);
                return await _photoUploadService.UploadPhotoAsync($"{Guid.NewGuid()}.{extension}", stream, contentType, cancellationToken);
            }
            catch
            {
                return null;
            }
        }

        public async Task<SyncBatchResponse> Handle(SyncBatchCommand request, CancellationToken cancellationToken)
        {
            var response = new SyncBatchResponse();

            // 1. Concurrent Photo Uploads
            // Pre-process all base64 images in the batch concurrently to avoid 
            // blocking the DB loop sequentially and timing out the HTTP connection.
            var uploadTasks = new Dictionary<string, Task<string?>>();
            foreach (var item in request.Items)
            {
                using var doc = JsonDocument.Parse(item.Payload);
                var root = doc.RootElement;
                if (item.Type == "contact_new" || item.Type == "contact_update")
                {
                    string? photoUrl = root.TryGetProperty("photoUrl", out var pProp) && pProp.ValueKind == JsonValueKind.String ? pProp.GetString() : null;
                    string? photoDataUri = root.TryGetProperty("photoDataUri", out var pdProp) && pdProp.ValueKind == JsonValueKind.String ? pdProp.GetString() : null;
                    if (string.IsNullOrEmpty(photoUrl) && !string.IsNullOrEmpty(photoDataUri))
                    {
                        uploadTasks[item.Id] = TryUploadDataUriAsync(photoDataUri, cancellationToken);
                    }
                }
                else if (item.Type == "contact_document")
                {
                    string? dataUri = root.TryGetProperty("dataUri", out var duProp) && duProp.ValueKind == JsonValueKind.String ? duProp.GetString() : null;
                    if (!string.IsNullOrEmpty(dataUri))
                    {
                        uploadTasks[item.Id] = TryUploadDataUriAsync(dataUri, cancellationToken);
                    }
                }
            }

            await Task.WhenAll(uploadTasks.Values);
            var preUploadedUrls = uploadTasks.ToDictionary(k => k.Key, v => v.Value.Result);

            // 2. In-batch Duplicate Tracking
            var batchPhones = new HashSet<string>();
            var batchNames = new HashSet<string>();

            foreach (var item in request.Items)
            {
                SyncResultDto result;
                try
                {
                    result = await ProcessItemAsync(item, request.AgentId, request.DeviceId, response.DuplicateWarnings, preUploadedUrls, batchPhones, batchNames, cancellationToken);

                    // Save per item, not once for the whole batch — otherwise a single
                    // conflict (e.g. a duplicate ClientId+DeviceId raced into the same
                    // batch) would throw here uncaught and roll back every other item
                    // this loop already successfully processed.
                    await _db.SaveChangesAsync(cancellationToken);
                }
                catch (Exception ex)
                {
                    // Detach whatever this item added/modified so the failure doesn't
                    // get retried (and re-fail) on every subsequent item's SaveChanges.
                    foreach (var entry in _db.ChangeTracker.Entries().ToList())
                    {
                        entry.State = EntityState.Detached;
                    }

                    result = new SyncResultDto
                    {
                        ClientId = item.ClientId,
                        DeviceId = item.DeviceId,
                        Status = "error",
                        ErrorMessage = ex.Message,
                    };
                }

                response.Results.Add(result);
            }

            return response;
        }

        private async Task<SyncResultDto> ProcessItemAsync(
            OutboxItemDto item,
            string agentId,
            string deviceId,
            List<DuplicateWarningDto> duplicateWarnings,
            Dictionary<string, string?> preUploadedUrls,
            HashSet<string> batchPhones,
            HashSet<string> batchNames,
            CancellationToken cancellationToken)
        {
            using var doc = JsonDocument.Parse(item.Payload);
            var root = doc.RootElement;
            var syncedAt = DateTime.UtcNow;

            switch (item.Type)
            {
                case "shift_start":
                case "shift_end":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    // Matched by ClientId alone — it's the record's permanent identity
                    // regardless of which device eventually syncs it (a reinstall/new
                    // phone gets a fresh DeviceId, but must still find records it
                    // already owns instead of forking a duplicate under the old one).
                    var existing = await _db.Shifts.FirstOrDefaultAsync(s => s.ClientId == clientId, cancellationToken);
                    if (existing == null)
                    {
                        var shift = new FieldShift
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            StartTime = GetDateTime(root, "startTime", DateTime.UtcNow),
                            EndTime = GetOptionalDateTime(root, "endTime"),
                            StartLat = GetDouble(root, "startLat", 0),
                            StartLng = GetDouble(root, "startLng", 0),
                            EndLat = GetOptionalDouble(root, "endLat"),
                            EndLng = GetOptionalDouble(root, "endLng"),
                            ServerReceivedAt = syncedAt
                        };
                        _db.Shifts.Add(shift);
                        return Result(clientId, deviceId, shift.Id, syncedAt, "created");
                    }
                    else
                    {
                        if (item.Type == "shift_end" && existing.EndTime == null)
                        {
                            existing.EndTime = GetOptionalDateTime(root, "endTime") ?? DateTime.UtcNow;
                            existing.EndLat = GetOptionalDouble(root, "endLat");
                            existing.EndLng = GetOptionalDouble(root, "endLng");
                        }
                        return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                    }
                }

                case "visit_checkin":
                case "visit_checkout":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.Visits.FirstOrDefaultAsync(v => v.ClientId == clientId, cancellationToken);
                    if (existing == null)
                    {
                        var visit = new FieldVisit
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            PanchayatId = GetString(root, "panchayatId", ""),
                            CheckInAt = GetDateTime(root, "checkInAt", DateTime.UtcNow),
                            CheckOutAt = GetOptionalDateTime(root, "checkOutAt"),
                            CheckInLat = GetDouble(root, "checkInLat", 0),
                            CheckInLng = GetDouble(root, "checkInLng", 0),
                            CheckOutLat = GetOptionalDouble(root, "checkOutLat"),
                            CheckOutLng = GetOptionalDouble(root, "checkOutLng"),
                            ServerReceivedAt = syncedAt
                        };
                        _db.Visits.Add(visit);
                        return Result(clientId, deviceId, visit.Id, syncedAt, "created");
                    }
                    else
                    {
                        if (item.Type == "visit_checkout" && existing.CheckOutAt == null)
                        {
                            existing.CheckOutAt = GetOptionalDateTime(root, "checkOutAt") ?? DateTime.UtcNow;
                            existing.CheckOutLat = GetOptionalDouble(root, "checkOutLat");
                            existing.CheckOutLng = GetOptionalDouble(root, "checkOutLng");
                        }
                        return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                    }
                }

                case "contact_new":
                case "contact_update":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);

                    string phone = GetString(root, "phone", "");
                    string name = GetString(root, "name", "");
                    string panchayatId = GetString(root, "panchayatId", "");
                    string? shiftId = root.TryGetProperty("shiftId", out var shiftProp) && shiftProp.ValueKind == JsonValueKind.String ? shiftProp.GetString() : null;
                    string role = GetString(root, "role", "");
                    string? profession = root.TryGetProperty("profession", out var profProp) && profProp.ValueKind == JsonValueKind.String ? profProp.GetString() : null;
                    bool whatsapp = GetBool(root, "whatsappAdded", false);
                    bool card = GetBool(root, "cardGiven", false);
                    string status = GetString(root, "status", "Lead");
                    DateTime? followUpDate = GetOptionalDateTime(root, "followUpDate");
                    string? comments = root.TryGetProperty("notes", out var nProp) && nProp.ValueKind == JsonValueKind.String ? nProp.GetString() 
                                     : root.TryGetProperty("comments", out var cProp) && cProp.ValueKind == JsonValueKind.String ? cProp.GetString() : null;
                    double? lat = GetOptionalDouble(root, "lat");
                    double? lng = GetOptionalDouble(root, "lng");
                    bool isImportant = GetBool(root, "isImportant", false);
                    bool agentEscalated = GetBool(root, "agentEscalated", false);
                    string? agentEscalationNote = root.TryGetProperty("agentEscalationNote", out var aenProp) && aenProp.ValueKind == JsonValueKind.String ? aenProp.GetString() : null;
                    string? photoUrl = root.TryGetProperty("photoUrl", out var pProp) && pProp.ValueKind == JsonValueKind.String ? pProp.GetString() : null;
                    // Contacts captured in the field store their photo as a base64 data URI
                    // (no guaranteed connection at capture time) — finish that upload now
                    // that this sync has a connection. A caller that already has a real
                    // URL (e.g. an admin-side edit) takes priority over re-uploading.
                    string? photoDataUri = root.TryGetProperty("photoDataUri", out var pdProp) && pdProp.ValueKind == JsonValueKind.String ? pdProp.GetString() : null;
                    if (string.IsNullOrEmpty(photoUrl) && !string.IsNullOrEmpty(photoDataUri))
                    {
                        preUploadedUrls.TryGetValue(item.Id, out photoUrl);
                    }

                    if (existing == null)
                    {
                        var contact = new OutreachContact
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            PanchayatId = panchayatId,
                            ShiftId = shiftId,
                            Role = role,
                            Profession = profession,
                            Name = name,
                            Phone = phone,
                            WhatsappAdded = whatsapp,
                            CardGiven = card,
                            Status = status,
                            FollowUpDate = followUpDate,
                            Comments = comments,
                            Complaints = GetString(root, "complaints", null),
                            Conflicts = GetString(root, "conflicts", null),
                            Latitude = lat,
                            Longitude = lng,
                            AgentEscalated = agentEscalated,
                            AgentEscalationNote = agentEscalationNote,
                            IsImportant = isImportant,
                            PhotoUrl = photoUrl,
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            ServerReceivedAt = syncedAt
                        };

                        // ─── Server-side Duplicate Detection ──────────────────
                        if (!string.IsNullOrEmpty(phone) || !string.IsNullOrEmpty(name))
                        {
                            var potentialDups = await _db.Contacts
                                .Where(c => c.PanchayatId == panchayatId && c.ClientId != clientId)
                                .ToListAsync(cancellationToken);

                            bool foundDup = false;
                            foreach (var dup in potentialDups)
                            {
                                bool phoneMatch = !string.IsNullOrEmpty(phone) && !string.IsNullOrEmpty(dup.Phone) && dup.Phone == phone;
                                bool nameMatch = !string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(dup.Name) && CalculateSimilarity(name, dup.Name) >= 85;

                                if (phoneMatch || nameMatch)
                                {
                                    contact.PotentialDuplicateOf = dup.ClientId;
                                    duplicateWarnings.Add(new DuplicateWarningDto
                                    {
                                        ClientId = clientId,
                                        PotentialDuplicateOf = dup.ClientId,
                                        Reason = phoneMatch ? $"Exact Phone Match ({phone}) in {panchayatId}" : $"Similar Name ({name} ≈ {dup.Name}) in {panchayatId}",
                                        MatchScore = phoneMatch ? 99 : 88
                                    });
                                    foundDup = true;
                                    break;
                                }
                            }

                            // Check in-batch duplicates to prevent identical offline records from racing
                            if (!foundDup)
                            {
                                bool batchPhoneMatch = !string.IsNullOrEmpty(phone) && batchPhones.Contains(phone);
                                bool batchNameMatch = !string.IsNullOrEmpty(name) && batchNames.Contains(name);

                                if (batchPhoneMatch || batchNameMatch)
                                {
                                    contact.PotentialDuplicateOf = "in_batch_duplicate";
                                    duplicateWarnings.Add(new DuplicateWarningDto
                                    {
                                        ClientId = clientId,
                                        PotentialDuplicateOf = "in_batch_duplicate",
                                        Reason = batchPhoneMatch ? $"Exact Phone Match ({phone}) within same offline batch" : $"Exact Name Match ({name}) within same offline batch",
                                        MatchScore = batchPhoneMatch ? 99 : 88
                                    });
                                }
                            }

                            if (!string.IsNullOrEmpty(phone)) batchPhones.Add(phone);
                            if (!string.IsNullOrEmpty(name)) batchNames.Add(name);
                        }

                        _db.Contacts.Add(contact);
                        _db.ContactHistory.Add(new ContactHistoryEntry
                        {
                            ContactClientId = clientId,
                            UpdatedBy = agentId,
                            PreviousStatus = "None",
                            NewStatus = contact.Status,
                            Comments = contact.Comments,
                            FollowUpDate = contact.FollowUpDate,
                            Complaints = contact.Complaints,
                            Conflicts = contact.Conflicts
                        });
                        return Result(clientId, deviceId, contact.Id, syncedAt, "created");
                    }
                    else
                    {
                        if (item.Type == "contact_update" || item.Type == "contact_new")
                        {
                            existing.Name = name;
                            existing.Phone = phone;
                            existing.Role = role;
                            existing.Profession = profession;
                            existing.WhatsappAdded = whatsapp;
                            existing.CardGiven = card;
                            existing.IsImportant = isImportant;
                            existing.Latitude = lat ?? existing.Latitude;
                            existing.Longitude = lng ?? existing.Longitude;
                            if (!string.IsNullOrEmpty(photoUrl)) existing.PhotoUrl = photoUrl;

                            // NOTE: We do NOT blindly overwrite Status, FollowUpDate, or Comments
                            // from a delayed offline sync if the server's LastModifiedAt is newer
                            // (ContactsController.UpdateContact, which bumps LastModifiedAt).
                            // An outbox item can sit queued on a device for a long time before
                            // it gets a chance to sync, so its own edit timestamp — not "now" —
                            // has to be newer than the server's LastModifiedAt before these
                            // fields are allowed to overwrite a possibly-more-recent admin edit.
                            var itemEditedAt = DateTime.TryParse(
                                item.Timestamp, null,
                                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                                out var parsed) ? parsed : DateTime.UtcNow;
                            bool isNewerThanServer = itemEditedAt >= existing.LastModifiedAt;

                            if (isNewerThanServer)
                            {
                                existing.AgentEscalated = agentEscalated;
                                existing.AgentEscalationNote = agentEscalationNote;

                                var previousStatus = existing.Status;
                                var previousComments = existing.Comments;
                                var previousFollowUpDate = existing.FollowUpDate;

                                existing.Status = status;
                                existing.FollowUpDate = followUpDate;
                                if (comments != null) existing.Comments = comments;
                                if (root.TryGetProperty("complaints", out var cp) && cp.ValueKind == JsonValueKind.String) existing.Complaints = cp.GetString();
                                if (root.TryGetProperty("conflicts", out var cf) && cf.ValueKind == JsonValueKind.String) existing.Conflicts = cf.GetString();

                                // Guard against outbox retries re-sending the same unchanged item
                                // and spamming the audit trail with no-op entries.
                                if (previousStatus != existing.Status ||
                                    previousComments != existing.Comments ||
                                    previousFollowUpDate != existing.FollowUpDate)
                                {
                                    existing.LastModifiedAt = DateTime.UtcNow;
                                    _db.ContactHistory.Add(new ContactHistoryEntry
                                    {
                                        ContactClientId = clientId,
                                        UpdatedBy = agentId,
                                        PreviousStatus = previousStatus,
                                        NewStatus = existing.Status,
                                        Comments = existing.Comments,
                                        FollowUpDate = existing.FollowUpDate,
                                        Complaints = existing.Complaints,
                                        Conflicts = existing.Conflicts
                                    });
                                }
                            }
                        }
                        return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                    }
                }

                case "referral_new":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.Referrals.FirstOrDefaultAsync(r => r.ClientId == clientId, cancellationToken);
                    if (existing == null)
                    {
                        var refObj = new PatientReferral
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            ContactId = GetString(root, "contactId", ""),
                            AgentId = agentId,
                            PatientName = GetString(root, "patientName", ""),
                            Department = GetString(root, "department", ""),
                            Notes = GetString(root, "notes", ""),
                            ClientPhone = root.TryGetProperty("clientPhone", out var refPhoneProp) && refPhoneProp.ValueKind == JsonValueKind.String ? refPhoneProp.GetString() : null,
                            ReferralDate = GetOptionalDateTime(root, "referralDate"),
                            Status = GetString(root, "status", "pending"),
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            ServerReceivedAt = syncedAt
                        };
                        _db.Referrals.Add(refObj);
                        return Result(clientId, deviceId, refObj.Id, syncedAt, "created");
                    }
                    return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                }

                case "panchayat_new":
                {
                    // Agent-added when the seeded LGD list is missing their actual
                    // location — the client generates this id itself (there's no
                    // separate ClientId/server-Guid split like the other entities;
                    // Panchayat's own string PanchayatId already is the shared key),
                    // so an existence check by that id alone is enough to dedupe a
                    // retried sync.
                    string panchayatId = GetString(root, "id", item.ClientId);
                    var existingPanchayat = await _db.Panchayats.FirstOrDefaultAsync(p => p.PanchayatId == panchayatId, cancellationToken);
                    if (existingPanchayat == null)
                    {
                        _db.Panchayats.Add(new Panchayat
                        {
                            PanchayatId = panchayatId,
                            Name = GetString(root, "name", ""),
                            District = GetString(root, "district", ""),
                            Block = GetString(root, "block", ""),
                            State = GetString(root, "state", "Bihar"),
                            LgdCode = GetString(root, "lgdCode", ""),
                            CentroidLat = GetOptionalDouble(root, "centroidLat"),
                            CentroidLng = GetOptionalDouble(root, "centroidLng"),
                        });
                    }
                    return new SyncResultDto
                    {
                        ClientId = item.ClientId,
                        DeviceId = deviceId,
                        ServerId = panchayatId,
                        SyncedAt = syncedAt.ToString("o"),
                        Status = existingPanchayat == null ? "created" : "already_exists",
                    };
                }

                case "trajectory_batch":
                {
                    string batchClientId = GetString(root, "clientId", item.ClientId);
                    if (root.TryGetProperty("points", out var pointsEl) && pointsEl.ValueKind == JsonValueKind.Array)
                    {
                        var points = pointsEl.EnumerateArray().Select(ptEl => new
                        {
                            ClientId = GetString(ptEl, "clientId", Guid.NewGuid().ToString()),
                            Lat = GetDouble(ptEl, "lat", 0),
                            Lng = GetDouble(ptEl, "lng", 0),
                            RecordedAt = GetDateTime(ptEl, "recordedAt", DateTime.UtcNow),
                            AccuracyM = GetOptionalDouble(ptEl, "accuracyM"),
                        }).ToList();

                        var ptClientIds = points.Select(p => p.ClientId).ToList();
                        var existingIds = await _db.TrajectoryPoints
                            .Where(t => ptClientIds.Contains(t.ClientId))
                            .Select(t => t.ClientId)
                            .ToListAsync(cancellationToken);
                        var existingSet = existingIds.ToHashSet();

                        foreach (var pt in points)
                        {
                            if (!existingSet.Contains(pt.ClientId))
                            {
                                _db.TrajectoryPoints.Add(new TrajectoryPoint
                                {
                                    ClientId = pt.ClientId,
                                    DeviceId = deviceId,
                                    AgentId = agentId,
                                    Lat = pt.Lat,
                                    Lng = pt.Lng,
                                    RecordedAt = pt.RecordedAt,
                                    AccuracyM = pt.AccuracyM,
                                    ServerReceivedAt = syncedAt
                                });
                            }
                        }
                    }
                    return Result(batchClientId, deviceId, Guid.NewGuid(), syncedAt, "created");
                }

                case "survey":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.SurveyResponses.FirstOrDefaultAsync(s => s.ClientId == clientId, cancellationToken);
                    if (existing == null)
                    {
                        var survey = new SurveyResponse
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            ContactId = GetString(root, "contactId", ""),
                            PanchayatId = GetString(root, "panchayatId", ""),
                            AnswersJson = GetString(root, "answersJson", "{}"),
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            SyncedAt = syncedAt
                        };
                        _db.SurveyResponses.Add(survey);
                        return Result(clientId, deviceId, survey.Id, syncedAt, "created");
                    }
                    return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                }

                case "contact_document":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.ContactDocuments.FirstOrDefaultAsync(d => d.ClientId == clientId, cancellationToken);
                    if (existing == null)
                    {
                        string? dataUri = root.TryGetProperty("dataUri", out var duProp) && duProp.ValueKind == JsonValueKind.String ? duProp.GetString() : null;
                        preUploadedUrls.TryGetValue(item.Id, out var url);
                        
                        if (string.IsNullOrEmpty(url)) 
                        {
                            // If upload fails, mark error so it retries later
                            return new SyncResultDto
                            {
                                ClientId = item.ClientId,
                                DeviceId = deviceId,
                                Status = "error",
                                ErrorMessage = "Failed to upload document file.",
                            };
                        }

                        var docItem = new ContactDocument
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            ContactClientId = GetString(root, "contactId", ""),
                            Url = url,
                            MimeType = GetString(root, "mimeType", ""),
                            Label = root.TryGetProperty("label", out var labelProp) && labelProp.ValueKind == JsonValueKind.String ? labelProp.GetString() : null,
                            ExifLatitude = GetOptionalDouble(root, "exifLat"),
                            ExifLongitude = GetOptionalDouble(root, "exifLng"),
                            ExifCapturedAt = root.TryGetProperty("exifCapturedAt", out var exifDateProp) && exifDateProp.ValueKind == JsonValueKind.String 
                                ? (DateTime.TryParse(exifDateProp.GetString(), out var parsedExif) ? parsedExif.ToUniversalTime() : null) 
                                : null,
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            ServerReceivedAt = syncedAt
                        };
                        _db.ContactDocuments.Add(docItem);
                        return Result(clientId, deviceId, docItem.Id, syncedAt, "created");
                    }
                    return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                }

                default:
                    return new SyncResultDto
                    {
                        ClientId = item.ClientId,
                        DeviceId = deviceId,
                        Status = "error",
                        ErrorMessage = $"Unrecognized sync item type '{item.Type}'.",
                    };
            }
        }

        private static SyncResultDto Result(string clientId, string deviceId, Guid serverId, DateTime syncedAt, string status) => new()
        {
            ClientId = clientId,
            DeviceId = deviceId,
            ServerId = serverId.ToString(),
            SyncedAt = syncedAt.ToString("o"),
            Status = status,
        };

        // Substring containment (the previous heuristic) both over- and under-flags:
        // "Ram" is a substring of "Shyam Ram Yadav" (unrelated people, false positive)
        // while "Md. Rajesh" vs "Mohd Rajesh" share no substring relationship at all
        // (real near-duplicate, false negative). Levenshtein edit distance normalized
        // to the longer string's length handles typos/spacing/abbreviation drift
        // without either failure mode.
        private static int CalculateSimilarity(string s1, string s2)
        {
            s1 = s1.Trim().ToLowerInvariant();
            s2 = s2.Trim().ToLowerInvariant();
            if (s1 == s2) return 100;
            if (s1.Length == 0 || s2.Length == 0) return 0;

            int distance = LevenshteinDistance(s1, s2);
            int maxLen = Math.Max(s1.Length, s2.Length);
            return (int)Math.Round((1.0 - (double)distance / maxLen) * 100);
        }

        private static int LevenshteinDistance(string s1, string s2)
        {
            var prev = new int[s2.Length + 1];
            var curr = new int[s2.Length + 1];
            for (int j = 0; j <= s2.Length; j++) prev[j] = j;

            for (int i = 1; i <= s1.Length; i++)
            {
                curr[0] = i;
                for (int j = 1; j <= s2.Length; j++)
                {
                    int cost = s1[i - 1] == s2[j - 1] ? 0 : 1;
                    curr[j] = Math.Min(Math.Min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
                }
                (prev, curr) = (curr, prev);
            }

            return prev[s2.Length];
        }

        private static string GetString(JsonElement el, string prop, string def)
            => el.TryGetProperty(prop, out var p) && p.ValueKind == JsonValueKind.String ? (p.GetString() ?? def) : def;

        private static double GetDouble(JsonElement el, string prop, double def)
            => el.TryGetProperty(prop, out var p) && p.TryGetDouble(out var d) ? d : def;

        private static double? GetOptionalDouble(JsonElement el, string prop)
            => el.TryGetProperty(prop, out var p) && p.TryGetDouble(out var d) ? d : null;

        private static bool GetBool(JsonElement el, string prop, bool def)
            => el.TryGetProperty(prop, out var p) && (p.ValueKind == JsonValueKind.True || p.ValueKind == JsonValueKind.False) ? p.GetBoolean() : def;

        private static DateTime GetDateTime(JsonElement el, string prop, DateTime def)
            => el.TryGetProperty(prop, out var p) && p.TryGetDateTime(out var dt) ? dt.ToUniversalTime() : def;

        private static DateTime? GetOptionalDateTime(JsonElement el, string prop)
            => el.TryGetProperty(prop, out var p) && p.TryGetDateTime(out var dt) ? dt.ToUniversalTime() : null;
    }
}
