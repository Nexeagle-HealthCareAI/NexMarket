using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Application.Services;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize(Roles = "Admin")]
    public class HealthcareDashboardController : ControllerBase
    {
        private readonly AnalyticsEngineService _analyticsService;

        public HealthcareDashboardController(AnalyticsEngineService analyticsService)
        {
            _analyticsService = analyticsService;
        }

        [HttpGet("kpis")]
        public async Task<IActionResult> GetKpis([FromQuery] string? district, [FromQuery] string? block)
        {
            var kpis = await _analyticsService.CalculateExecutiveKpisAsync(district, block);
            return Ok(kpis);
        }

        [HttpGet("pricing-curve")]
        public async Task<IActionResult> GetPricingCurve()
        {
            var pricing = await _analyticsService.CalculatePriceElasticityAsync();
            return Ok(pricing);
        }
    }
}
