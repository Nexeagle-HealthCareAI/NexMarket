using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WaBillingSettingsDto
    {
        public decimal MonthlyBudget { get; set; }
        public int AlertPercent { get; set; } = 80;
        public bool StopAtBudget { get; set; }
        public Dictionary<string, string> NumberLabels { get; set; } = new();
    }

    /// <summary>
    /// WhatsApp → Billing: what messages cost this month (from Meta), split by type, day and sending number, the
    /// monthly budget, and whether a payment method is attached. Meta doesn't let apps read invoices, the balance due
    /// or card details, so those stay in Meta's Billing &amp; payments (the page links there).
    /// Only people who can manage WhatsApp see spend.
    /// </summary>
    [ApiController]
    [Route("api/v1/whatsapp/billing")]
    [Authorize]
    [PageAccess(Pages.WhatsApp, Level = Pages.Edit)]
    public class WhatsAppBillingController : ControllerBase
    {
        private readonly WaBillingService _billing;
        private readonly IAppSettings _settings;
        private readonly WhatsAppOutbox _outbox;

        public WhatsAppBillingController(WaBillingService billing, IAppSettings settings, WhatsAppOutbox outbox)
        {
            _billing = billing;
            _settings = settings;
            _outbox = outbox;
        }

        /// <param name="month">yyyy-MM; this month when empty.</param>
        /// <param name="refresh">Read Meta again now instead of the copy from the last 10 minutes.</param>
        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] string? month, [FromQuery] bool refresh, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            int y = now.Year, m = now.Month;
            if (!string.IsNullOrWhiteSpace(month))
            {
                if (!DateTime.TryParseExact(month + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d))
                    return BadRequest(new { message = "Month looks like 2026-11." });
                if (d > now || d < now.AddMonths(-12)) return BadRequest(new { message = "Pick a month in the last year." });
                y = d.Year; m = d.Month;
            }
            var report = await _billing.ReportAsync(y, m, refresh, ct);
            var settings = WaBillingSettings.Load(_settings);
            var thisMonth = y == now.Year && m == now.Month;

            // A simple projection for the current month: spend so far ÷ days gone × days in the month.
            decimal? projected = null;
            if (thisMonth && report.Error == null)
            {
                var daysGone = Math.Max(1m, (decimal)(now - new DateTime(y, m, 1, 0, 0, 0, DateTimeKind.Utc)).TotalDays);
                projected = Math.Round(report.Total / daysGone * DateTime.DaysInMonth(y, m), 2);
            }
            var cfg = _outbox.Config;
            return Ok(new
            {
                report,
                thisMonth,
                projected,
                settings = new { settings.MonthlyBudget, settings.AlertPercent, settings.StopAtBudget, settings.NumberLabels },
                wabaId = cfg.BusinessAccountId,
            });
        }

        [HttpPut("settings")]
        public async Task<IActionResult> Save([FromBody] WaBillingSettingsDto dto, CancellationToken ct)
        {
            if (!User.IsAdmin()) return StatusCode(403, new { message = "Only an admin can change the WhatsApp budget." });
            if (dto.MonthlyBudget < 0 || dto.MonthlyBudget > 100_000_000) return BadRequest(new { message = "Budget must be 0 (no budget) or a positive amount." });
            if (dto.AlertPercent < 10 || dto.AlertPercent > 100) return BadRequest(new { message = "Warn between 10% and 100% of the budget." });
            var labels = new Dictionary<string, string>();
            foreach (var (k, v) in dto.NumberLabels ?? new())
            {
                var digits = new string((k ?? "").Where(char.IsDigit).ToArray());
                var name = (v ?? "").Trim();
                if (digits.Length < 8 || digits.Length > 15 || name.Length == 0) continue;
                if (name.Length > 80) return BadRequest(new { message = "Keep each name under 80 characters." });
                labels[digits] = name;
                if (labels.Count >= 100) break;
            }
            var s = new WaBillingSettings
            {
                MonthlyBudget = Math.Round(dto.MonthlyBudget, 2),
                AlertPercent = dto.AlertPercent,
                StopAtBudget = dto.StopAtBudget && dto.MonthlyBudget > 0,
                NumberLabels = labels,
            };
            await s.SaveAsync(_settings, User.AgentIdOf(), ct);
            WaBillingService.ClearCache();
            return Ok(new { ok = true });
        }
    }
}
