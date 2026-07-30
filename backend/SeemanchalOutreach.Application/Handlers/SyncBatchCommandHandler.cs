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

        public SyncBatchCommandHandler(IMarketingDbContext db)
        {
            _db = db;
        }

        public async Task<SyncBatchResponse> Handle(SyncBatchCommand request, CancellationToken cancellationToken)
        {
            var response = new SyncBatchResponse();

            foreach (var item in request.Items)
            {
                SyncResultDto result;
                try
                {
                    result = await ProcessItemAsync(item, request.AgentId, request.DeviceId, response.DuplicateWarnings, cancellationToken);

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
                    var existing = await _db.Shifts.FirstOrDefaultAsync(s => s.ClientId == clientId && s.DeviceId == deviceId, cancellationToken);
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
                    var existing = await _db.Visits.FirstOrDefaultAsync(v => v.ClientId == clientId && v.DeviceId == deviceId, cancellationToken);
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
                    var existing = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId && c.DeviceId == deviceId, cancellationToken);

                    string phone = GetString(root, "phone", "");
                    string name = GetString(root, "name", "");
                    string panchayatId = GetString(root, "panchayatId", "");
                    string role = GetString(root, "role", "");
                    bool whatsapp = GetBool(root, "whatsappAdded", false);
                    bool card = GetBool(root, "cardGiven", false);
                    string status = GetString(root, "status", "Lead");
                    DateTime? followUpDate = GetOptionalDateTime(root, "followUpDate");
                    string? comments = root.TryGetProperty("comments", out var cProp) && cProp.ValueKind == JsonValueKind.String ? cProp.GetString() : null;
                    double? lat = GetOptionalDouble(root, "lat");
                    double? lng = GetOptionalDouble(root, "lng");

                    if (existing == null)
                    {
                        var contact = new OutreachContact
                        {
                            ClientId = clientId,
                            DeviceId = deviceId,
                            AgentId = agentId,
                            PanchayatId = panchayatId,
                            Role = role,
                            Name = name,
                            Phone = phone,
                            WhatsappAdded = whatsapp,
                            CardGiven = card,
                            Status = status,
                            FollowUpDate = followUpDate,
                            Comments = comments,
                            Latitude = lat,
                            Longitude = lng,
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            ServerReceivedAt = syncedAt
                        };

                        // ─── Server-side Duplicate Detection ──────────────────
                        if (!string.IsNullOrEmpty(phone) || !string.IsNullOrEmpty(name))
                        {
                            var potentialDups = await _db.Contacts
                                .Where(c => c.PanchayatId == panchayatId && c.ClientId != clientId)
                                .ToListAsync(cancellationToken);

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
                                    break;
                                }
                            }
                        }

                        _db.Contacts.Add(contact);
                        _db.ContactHistory.Add(new ContactHistoryEntry
                        {
                            ContactClientId = clientId,
                            UpdatedBy = agentId,
                            PreviousStatus = "None",
                            NewStatus = contact.Status,
                            Comments = contact.Comments
                        });
                        return Result(clientId, deviceId, contact.Id, syncedAt, "created");
                    }
                    else
                    {
                        if (item.Type == "contact_update")
                        {
                            var previousStatus = existing.Status;
                            var previousComments = existing.Comments;

                            existing.Name = name;
                            existing.Phone = phone;
                            existing.Role = role;
                            existing.WhatsappAdded = whatsapp;
                            existing.CardGiven = card;

                            // Only update these fields if they are provided/changed from the client
                            // (If Hospital Rep updated it on server, we might need bi-directional sync,
                            // but currently agent -> server is master for these in standard sync)
                            existing.Status = status;
                            existing.FollowUpDate = followUpDate;
                            if (comments != null) existing.Comments = comments;
                            if (lat.HasValue) existing.Latitude = lat.Value;
                            if (lng.HasValue) existing.Longitude = lng.Value;

                            // Guard against outbox retries re-sending the same unchanged item and
                            // spamming the audit trail with no-op entries.
                            if (previousStatus != existing.Status || previousComments != existing.Comments)
                            {
                                _db.ContactHistory.Add(new ContactHistoryEntry
                                {
                                    ContactClientId = clientId,
                                    UpdatedBy = agentId,
                                    PreviousStatus = previousStatus,
                                    NewStatus = existing.Status,
                                    Comments = existing.Comments
                                });
                            }
                        }
                        return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                    }
                }

                case "referral_new":
                {
                    string clientId = GetString(root, "clientId", item.ClientId);
                    var existing = await _db.Referrals.FirstOrDefaultAsync(r => r.ClientId == clientId && r.DeviceId == deviceId, cancellationToken);
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
                            Status = GetString(root, "status", "pending"),
                            CreatedAt = GetDateTime(root, "createdAt", DateTime.UtcNow),
                            ServerReceivedAt = syncedAt
                        };
                        _db.Referrals.Add(refObj);
                        return Result(clientId, deviceId, refObj.Id, syncedAt, "created");
                    }
                    return Result(clientId, deviceId, existing.Id, syncedAt, "already_exists");
                }

                case "trajectory_batch":
                {
                    string batchClientId = GetString(root, "clientId", item.ClientId);
                    if (root.TryGetProperty("points", out var pointsEl) && pointsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var ptEl in pointsEl.EnumerateArray())
                        {
                            string ptClientId = GetString(ptEl, "clientId", Guid.NewGuid().ToString());
                            var exists = await _db.TrajectoryPoints.AnyAsync(t => t.ClientId == ptClientId && t.DeviceId == deviceId, cancellationToken);
                            if (!exists)
                            {
                                _db.TrajectoryPoints.Add(new TrajectoryPoint
                                {
                                    ClientId = ptClientId,
                                    DeviceId = deviceId,
                                    AgentId = agentId,
                                    Lat = GetDouble(ptEl, "lat", 0),
                                    Lng = GetDouble(ptEl, "lng", 0),
                                    RecordedAt = GetDateTime(ptEl, "recordedAt", DateTime.UtcNow),
                                    AccuracyM = GetOptionalDouble(ptEl, "accuracyM"),
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
                    var existing = await _db.SurveyResponses.FirstOrDefaultAsync(s => s.ClientId == clientId && s.DeviceId == deviceId, cancellationToken);
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

        private static int CalculateSimilarity(string s1, string s2)
        {
            s1 = s1.Trim().ToLowerInvariant();
            s2 = s2.Trim().ToLowerInvariant();
            if (s1 == s2) return 100;
            if (s1.Contains(s2) || s2.Contains(s1)) return 90;
            return 0; // Simple heuristic for now
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
