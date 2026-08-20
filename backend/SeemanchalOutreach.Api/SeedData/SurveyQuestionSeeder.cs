using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Domain.Entities;
using System.Text.Json;

namespace SeemanchalOutreach.Api.SeedData
{
    public static class SurveyQuestionSeeder
    {
        public static async Task SeedIfEmptyAsync(Infrastructure.Persistence.MarketingDbContext db)
        {
            // Force clear ALL existing questions to ensure only our new 18 questions exist
            var existing = await db.SurveyQuestions.ToListAsync();
            if (existing.Any())
            {
                db.SurveyQuestions.RemoveRange(existing);
                await db.SaveChangesAsync();
            }

            db.SurveyQuestions.AddRange(
                new SurveyQuestion
                {
                    QuestionId = "morbidity_profile",
                    Text = "Yahan aamtaur par parivar aur ilaqe mein sabse zyada kis tarah ki bimari ya pareshani dekhi jaati hai? (What are the most common health problems or illnesses faced in your area?)",
                    Type = "multi",
                    Section = "Section A: Disease Prevalence & Clinical Gaps",
                    OptionsJson = "[\"Bukhar / Seasonal Infection: Typhoid, Malaria, Dengue, Viral Fever\", \"Pathri / Peshab / Prostate: Kidney/Gallbladder stone, Burning urination, Prostate enlargement\", \"Mahila Swasthya / Prasav: Delivery, C-Section, Infertility, Gynecological bleeding/infection\", \"Haddi / Jod Rog: Arthritis, Joint pain, Backache\", \"Trauma / Emergency: Road accidents, Bone fractures, Severe injuries\", \"Pet Rog / Piles: Acidity, Gastritis, Liver issues, Piles/Bawasir/Fistula\", \"Chronic Lifestyle Diseases: Diabetes (Sugar), High BP, Heart trouble, Paralysis/Stroke\", \"Bachhon ki Bimariyan: Pneumonia, Diarrhea, Malnutrition, Newborn complications\", \"Other\"]",
                    Order = 1
                },
                new SurveyQuestion
                {
                    QuestionId = "water_source",
                    Text = "Peene ke paani ka mukhya source kya hai? (What is the primary source of drinking water in your household/locality?)",
                    Type = "single",
                    Section = "Section A: Disease Prevalence & Clinical Gaps",
                    OptionsJson = "[\"Sadharan Hand Pump / Chhapakal (Shallow tubewell / Hand pump \u2014 High iron/arsenic risk)\", \"Deep Boring / Filtered Hand Pump (Deep tubewell)\", \"Nal-Jal Yojana / Govt Piped Water Supply\", \"Nadi / Pokhar / Kuan (Surface water \u2014 River / Pond / Well)\", \"Packaged / Filtered Water Cans (Commercial RO water)\"]",
                    Order = 2
                },
                new SurveyQuestion
                {
                    QuestionId = "specialist_deficit",
                    Text = "Yahan sabse zyada kis specialist doctor ki kami mehsoos hoti hai jinke liye logon ko bahar shehar jaana padta hai? (Which specialist doctor is most urgently missing in your immediate locality?)",
                    Type = "multi",
                    Section = "Section A: Disease Prevalence & Clinical Gaps",
                    OptionsJson = "[\"Mahila Rog Visheshagya (Gynecologist & Obstetrician): 24/7 Normal & C-Section delivery\", \"Pathri aur Peshab Rog Visheshagya (Urologist / Stone Surgeon): Laser Stone & Prostate care\", \"Haddi, Jod aur Trauma Specialist (Orthopedic Surgeon): Fracture fixation, Joint replacement\", \"Bachhon ke Doctor (Pediatrician & Neonatologist): Child care + NICU\", \"Pet, Liver aur Laparoscopic Surgeon (General Surgeon): Gallbladder, Appendix, Hernia\", \"Dil ke Doctor (Cardiologist): Chest pain, Heart attack stabilization\", \"Aankh ke Doctor (Ophthalmologist): Cataract / Eye surgery\", \"Neuro / Brain-Spine Specialist: Head injury, Stroke, Nerve pain\"]",
                    Order = 3
                },
                new SurveyQuestion
                {
                    QuestionId = "treatment_destination",
                    Text = "Agar kisi ko specialist ilaaj ya operation (jaise delivery, pathri, fracture) ki zaroorat ho, to log kahan jaate hain? (Where do people typically go for surgical or specialist treatments?)",
                    Type = "single",
                    Section = "Section B: Healthcare Seeking Behavior & Medical Outflow (Migration)",
                    OptionsJson = "[\"Yahin block / gaon ke local clinic ya nursing home mein (Treated locally)\", \"Kishanganj Town\", \"Islampur Town\", \"Purnea\", \"Siliguri / North Bengal Medical College (NBMCH)\", \"Patna / Kolkata / Katihar\", \"Kahin nahi jaate / Kharche aur doori ke dar se ilaaj chhod dete hain (Untreated / Dropped out)\"]",
                    Order = 4
                },
                new SurveyQuestion
                {
                    QuestionId = "migration_barriers",
                    Text = "Bahar ke bade shehar (Siliguri/Purnea/Patna) jaakar ilaaj karwane mein sabse badi mushkil kya aati hai? (What is the biggest difficulty when travelling to distant cities for medical care?)",
                    Type = "multi",
                    Section = "Section B: Healthcare Seeking Behavior & Medical Outflow (Migration)",
                    OptionsJson = "[\"Aane-jaane aur hotel/dharamsala mein rehne-khane ka bhari kharch (High travel & lodging expense)\", \"Kaam chhutna aur rozi-roti/dihadi ka nuksan (Loss of daily wages for patient & attendants)\", \"Anjaan shehar mein thagi, dalali aur zyadatar bill banne ka dar (Fear of being cheated / Dalal exploitation)\", \"Language aur baat karne ki dikkat (Language barrier \u2014 Surjapuri/Bengali vs. City staff)\", \"Operation ke baad patti/dressing ya follow-up ke liye baar-baar jaana (Inconvenient post-op visits)\"]",
                    Order = 5
                },
                new SurveyQuestion
                {
                    QuestionId = "treatment_seeking_delay",
                    Text = "Bimari hone par specialist doctor ke paas pahunchne mein aamtaur par kitna samay lagta hai? (How much time is typically lost before a patient reaches a qualified specialist?)",
                    Type = "single",
                    Section = "Section B: Healthcare Seeking Behavior & Medical Outflow (Migration)",
                    OptionsJson = "[\"1\u20132 din ke andar turant dikha lete hain (Immediate specialist care)\", \"1\u20132 hafte tak gaon ke local dawai dukan/RMP se dawai chalti hai (1\u20132 weeks lost in local trials)\", \"1 mahine se zyada talte hain jab tak takleef bardasht se bahar na ho jaye (1+ month delay until acute crisis)\", \"Sirf emergency/behosh hone par hi bade hospital jaate hain (Only during terminal emergencies)\"]",
                    Order = 6
                },
                new SurveyQuestion
                {
                    QuestionId = "diagnostic_access",
                    Text = "Ultrasound (USG), X-Ray ya zaroori blood test karwane ke liye logon ko kya karna padta hai? (How do people access Ultrasound, X-Ray, and advanced diagnostic tests?)",
                    Type = "single",
                    Section = "Section C: Diagnostics, Pharmacy & Critical Emergency Infrastructure",
                    OptionsJson = "[\"Local market mein hi usi din test hokar report mil jaati hai (Local same-day availability)\", \"Kishanganj / Islampur / Purnea / Siliguri jaana padta hai (Have to travel to district HQ/city)\", \"Test ek din hota hai aur report lene agle din dobara shehar aana padta hai (Delayed 24\u201348 hr reporting)\", \"Kharche ya doori ki wajah se log test karwana avoid karte hain (Skip diagnostics)\"]",
                    Order = 7
                },
                new SurveyQuestion
                {
                    QuestionId = "blood_availability",
                    Text = "Delivery ya accident ke emergency waqt agar khoon (Blood) ki zaroorat pade, to kya sthiti hoti hai? (Is blood readily available during emergency deliveries or trauma cases?)",
                    Type = "single",
                    Section = "Section C: Diagnostics, Pharmacy & Critical Emergency Infrastructure",
                    OptionsJson = "[\"Yahin aas-paas Blood Bank ya donor se turant mil jaata hai (Available locally)\", \"Kishanganj Sadar / Purnea / Siliguri jakar laana padta hai (Have to travel 40\u201380 km for blood)\", \"Khoon na milne ke dar se local hospital admit karne se mana kar deta hai aur aage refer kar deta hai (Referred away due to blood deficit)\"]",
                    Order = 8
                },
                new SurveyQuestion
                {
                    QuestionId = "pharmacy_credit_dependency",
                    Text = "Kya is ilaqe mein log local dawai dukan (Chemist) ya RMP se udhaar par dawai aur ilaaj lete hain? (Do patients rely on store credit / delayed payment from local RMPs and pharmacies?)",
                    Type = "single",
                    Section = "Section C: Diagnostics, Pharmacy & Critical Emergency Infrastructure",
                    OptionsJson = "[\"Haan, adhiktar log mahine ke ant ya fasal bikne par hisab karte hain (High reliance on credit/udhaar)\", \"Sirf thoda-bohot udhaar jaankar logon ko milta hai (Limited credit for known people)\", \"Nahi, sabhi jagah turant cash mein payment hota hai (Strictly cash only)\"]",
                    Order = 9
                },
                new SurveyQuestion
                {
                    QuestionId = "emergency_transport",
                    Text = "Raat mein ya emergency (jaise delivery dard, heart problem, ya accident) hone par log hospital kaise pahunchte hain? (How do families reach the hospital during medical emergencies?)",
                    Type = "single",
                    Section = "Section D: Emergency Transit & Digital Readiness",
                    OptionsJson = "[\"108 Sarkari Ambulance se (Govt 108 Ambulance)\", \"Nijee Gadi (Bolero / Scorpio / Taxi) book karke (Hired private 4-wheeler)\", \"Toto / Auto / Bike par kisi tarah baitha kar (Open 2-wheeler or 3-wheeler)\", \"Koi bharosemand vyavastha nahi hai, gaadi khojne mein 2\u20134 ghante barbad hote hain (No reliable transit / Delays)\"]",
                    Order = 10
                },
                new SurveyQuestion
                {
                    QuestionId = "digital_health_literacy",
                    Text = "Kya mareez ya unke parivar wale WhatsApp par report bhejna ya doctor se online follow-up lena pasand karenge? (Are families comfortable sharing USG/blood reports over WhatsApp for remote doctor advice?)",
                    Type = "single",
                    Section = "Section D: Emergency Transit & Digital Readiness",
                    OptionsJson = "[\"Haan, smart phone hai aur WhatsApp chala kar report bhej sakte hain (Direct smartphone user)\", \"Khud nahi, par gaon ke kisi ladke ya local dawai dukan wale ki madad se bhejwa sakte hain (Assisted digital user)\", \"Nahi, bilkul samajh nahi aayega, aamne-saamne aakar hi dikhana pasand karenge (Strictly in-person only)\"]",
                    Order = 11
                },
                new SurveyQuestion
                {
                    QuestionId = "payment_funding_source",
                    Text = "Parivar mein kisi aam operation ya badi bimari ka kharch aamtaur par kaise manage hota hai? (How is the financial cost of a surgery or hospitalization funded?)",
                    Type = "single",
                    Section = "Section E: Pricing, Affordability & Government Schemes",
                    OptionsJson = "[\"Ayushman Bharat (PM-JAY) Golden Card se: Bihar resident\", \"Swasthya Sathi Card se: West Bengal resident\", \"Apni personal bachat / Cash se: Household savings\", \"Karz lekar ya byaaj par paise utha kar: Borrowing from moneylenders / Local loan\", \"Zameen, jaanwar (Gay/Bakri) ya gahna bech/girwi rakh kar: Distress asset sale\", \"Nijee Mediclaim Insurance: Private health insurance (Star Health, Care, etc.)\"]",
                    Order = 12
                },
                new SurveyQuestion
                {
                    QuestionId = "affordable_surgical_budget",
                    Text = "Kisi aam routine operation (jaise Laparoscopic Pathri, Hernia, ya Normal/C-Section Delivery) ke liye all-inclusive kitna kharch log aasaani se de sakte hain? (What is an affordable, all-inclusive price range for a standard surgical procedure?)",
                    Type = "single",
                    Section = "Section E: Pricing, Affordability & Government Schemes",
                    OptionsJson = "[\"\u20b98,000 \u2013 \u20b914,000 (Very low cost / High scheme dependency)\", \"\u20b914,000 \u2013 \u20b922,000 (Low-middle bracket \u2014 High volume target)\", \"\u20b922,000 \u2013 \u20b932,000 (Middle bracket \u2014 Competitive private daycare surgery)\", \"\u20b932,000 \u2013 \u20b945,000 (Upper-middle bracket)\", \"\u20b945,000 se zyada (Premium / Tertiary care budget)\"]",
                    Order = 13
                },
                new SurveyQuestion
                {
                    QuestionId = "agricultural_seasonality",
                    Text = "Kheti/Baadh (Monsoon/Flood) ya fasal katne ke samay kya log elective operation (jaise pathri ya hernia) taalte hain? (Do people delay planned surgeries during floods or until harvest season when cash is available?)",
                    Type = "single",
                    Section = "Section E: Pricing, Affordability & Government Schemes",
                    OptionsJson = "[\"Haan, jab fasal bikti hai (Makhana, Jute, Dhan, Chai Patti) tabhi ilaaj karwate hain (High harvest cash dependency)\", \"Baadh (Floods/Rain) ke mausam mein aana-jaana mushkil hota hai isliye operation taalte hain (Monsoon mobility barrier)\", \"Bimari zyada hone par turant karwate hain chahe karz lena pade (Emergency irrespective of season)\"]",
                    Order = 14
                },
                new SurveyQuestion
                {
                    QuestionId = "referral_decision_maker",
                    Text = "Jab gaon mein kisi mareez ko bade hospital refer karna hota hai, to hospital chunne ka final faisla kaun karta hai? (Who makes the final decision on which hospital the patient should visit?)",
                    Type = "single",
                    Section = "Section F: Referral Network & B2B Channel Integration",
                    OptionsJson = "[\"Local RMP / Gaon ke doctor ki salah par\", \"Local Medicine Shop / Chemist ke sujhav par\", \"Parivar ke mukhiya, buzurgan aur rishtedaar\", \"Gadi / Ambulance driver ke bataye hospital par (Driver commission influence)\", \"Mareez khud TV/Banner/Social Media/Parcham dekh kar\"]",
                    Order = 15
                },
                new SurveyQuestion
                {
                    QuestionId = "rmp_tele_triage_willingness",
                    Text = "[Target: RMPs, Clinic Operators & Chemists Only] Agar aapko ek dedicated doctor hotline di jaye jahan aap refer karne se pehle specialist se mareez ki sthiti discuss kar sakein, to kya aap mareez refer karenge? (If a dedicated specialist hotline is provided for pre-referral discussion, would you refer patients?)",
                    Type = "single",
                    Section = "Section F: Referral Network & B2B Channel Integration",
                    OptionsJson = "[\"Haan, bilkul (Yes, absolutely \u2014 High B2B conversion)\", \"Shayad, pehle hospital ki suvidha aur doctor ka vyavahar dekhna hoga (Trial first)\", \"Nahi (No)\", \"Pata nahi / Kah nahi sakte (Unsure)\"]",
                    Order = 16
                },
                new SurveyQuestion
                {
                    QuestionId = "trust_factors",
                    Text = "Kisi naye hospital ya clinic par vishwas karne ke liye aapke liye sabse zaroori 2 cheezein kya hain? (What are the top 2 most important factors when deciding to trust a new healthcare facility?)",
                    Type = "multi",
                    Section = "Section G: Trust Drivers & Competitor Mapping",
                    OptionsJson = "[\"Fixed Package Price: Bina kisi chhipe kharch ke pehle se tay package rate (No hidden billing)\", \"Doctor Reputation: Senior aur anubhavi doctor ki daily uplabdhata (Senior specialist presence)\", \"Local Language & Behavior: Staff ka achha vyavahar aur Surjapuri/Bengali/Hindi mein baat karna\", \"24/7 Facility & Cleanliness: Saaf-safai aur 24 ghante emergency/ICU/OT khula rehna\", \"Free/Hassle-free Card Facility: Ayushman / Swasthya Sathi card ka asaan cashless use\"]",
                    Order = 17
                },
                new SurveyQuestion
                {
                    QuestionId = "comp_name",
                    Text = "Is ilaqe mein log kis hospital ya doctor par sabse zyada vishwas karte hain? (Which hospital/doctor in this region is currently most trusted by locals?)",
                    Type = "text",
                    Section = "Section G: Trust Drivers & Competitor Mapping",
                    OptionsJson = null,
                    Order = 18
                },
                new SurveyQuestion
                {
                    QuestionId = "comp_location",
                    Text = "Preferred Hospital / Doctor Location:",
                    Type = "single",
                    Section = "Section G: Trust Drivers & Competitor Mapping",
                    OptionsJson = "[\"Local Block / Town\", \"Kishanganj\", \"Islampur\", \"Purnea\", \"Siliguri\", \"Other\"]",
                    Order = 19
                },
                new SurveyQuestion
                {
                    QuestionId = "comp_reason",
                    Text = "Main Reason for Trust:",
                    Type = "single",
                    Section = "Section G: Trust Drivers & Competitor Mapping",
                    OptionsJson = "[\"Sasta Ilaaj (Low cost / Free packages)\", \"Doctor ka purana naam aur tajarba (Doctor fame & experience)\", \"Ayushman / Swasthya Sathi accept hota hai (Government card)\", \"Staff aur doctor ka vyavahar achha hai (Courteous staff)\", \"Operation safal hone ka vishwas (High clinical success rate)\", \"Other\"]",
                    Order = 20
                }
            );
            await db.SaveChangesAsync();
        }
    }
}
