using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Domain.Entities;
using SeemanchalOutreach.Infrastructure.Persistence;

namespace SeemanchalOutreach.Api.SeedData
{
    public static class SurveyQuestionSeeder
    {
        /// <summary>
        /// The survey questionnaire used to be hardcoded into the agent app's
        /// translation files (a fixed fallback used whenever no SurveyQuestion rows
        /// existed). Seeds those same six questions as real, admin-editable rows —
        /// but only when the table is completely empty, so an admin who has already
        /// started configuring the questionnaire is never overwritten.
        /// </summary>
        public static async Task SeedIfEmptyAsync(MarketingDbContext db)
        {
            if (await db.SurveyQuestions.AnyAsync()) return;

            static string Opts(params string[] opts) => JsonSerializer.Serialize(opts);

            db.SurveyQuestions.AddRange(
                new SurveyQuestion
                {
                    QuestionId = "q1",
                    Text = "Yahan sabse zyada kis tarah ki bimari dikhti hai? (What's the most common health problem here?)",
                    Type = "single",
                    OptionsJson = Opts("Bukhar / Infection", "Pathri, peshab ya prostate ki samasya", "Mahila swasthya / prasav", "Anya (Other)"),
                    IsOptional = false,
                    IsActive = true,
                    Order = 1,
                },
                new SurveyQuestion
                {
                    QuestionId = "q2",
                    Text = "Specialist ilaaj (jaise operation) ke liye log kahan jaate hain? (Where do people go for specialist treatment?)",
                    Type = "single",
                    OptionsJson = Opts("Yahin gaon/block mein ho jaata hai", "Purnea/Kishanganj jaise nazdeeki shehar", "Patna/Kolkata/Siliguri jaana padta hai", "Kahin nahi jaate, ilaaj chhod dete hain"),
                    IsOptional = false,
                    IsActive = true,
                    Order = 2,
                },
                new SurveyQuestion
                {
                    QuestionId = "q3",
                    Text = "Peene ke paani ka main source kya hai? (Main drinking water source?)",
                    Type = "single",
                    OptionsJson = Opts("Hand Pump", "Piped Water", "River", "Other"),
                    IsOptional = false,
                    IsActive = true,
                    Order = 3,
                },
                new SurveyQuestion
                {
                    QuestionId = "q4",
                    Text = "Emergency mein log hospital kaise pahunchte hain? (How do people reach a hospital in an emergency?)",
                    Type = "single",
                    OptionsJson = Opts("Private Vehicle", "Shared Auto/Jeep", "Govt Ambulance (108)", "Koi bharosemand vyavastha nahi"),
                    IsOptional = false,
                    IsActive = true,
                    Order = 4,
                },
                new SurveyQuestion
                {
                    QuestionId = "q5",
                    Text = "Agar aap pehle doctor se phone par baat kar sakein, to kya aap patient refer karenge? (Would you refer if you could check with the doctor first?)",
                    Type = "single",
                    OptionsJson = Opts("Haan, bilkul", "Shayad, pehle dekhna hoga", "Nahi", "Pata nahi"),
                    IsOptional = false,
                    IsActive = true,
                    Order = 5,
                },
                new SurveyQuestion
                {
                    QuestionId = "q6",
                    Text = "Sabse badi rukawat kya hai jo logon ko yahan specialist ilaaj lene se rokti hai — aur kya koi aur hospital/clinic hai jise log pehle se pasand karte hain? (Biggest barrier to specialist care, and any hospital they already prefer?)",
                    Type = "text",
                    OptionsJson = null,
                    IsOptional = false,
                    IsActive = true,
                    Order = 6,
                }
            );

            await db.SaveChangesAsync();
        }
    }
}
