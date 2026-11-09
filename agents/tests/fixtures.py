"""A sample hospital for tests: departments, doctors with OPD days, two camps. Not real people."""

DEPARTMENTS = [{"id": f"dep-{n}", "name": n} for n in ["Eye", "Orthopaedics", "Gynaecology", "General Medicine", "Paediatrics", "Cardiology", "Dental", "General Surgery"]]
DOCTORS = [
    {"id": "doc-eye", "name": "Dr. Anjali Verma", "department": "Eye", "qualification": "MS Ophthalmology", "opdDays": "Tuesday, Friday", "opdTimings": "10 am - 2 pm"},
    {"id": "doc-ortho", "name": "Dr. Imtiyaz Alam", "department": "Orthopaedics", "qualification": "MS Ortho", "opdDays": "Monday, Wednesday, Saturday", "opdTimings": "11 am - 4 pm"},
    {"id": "doc-gyn", "name": "Dr. Shabnam Khatoon", "department": "Gynaecology", "qualification": "MD OBG", "opdDays": "Monday to Saturday", "opdTimings": "9 am - 1 pm"},
    {"id": "doc-med", "name": "Dr. Rakesh Jha", "department": "General Medicine", "qualification": "MD Medicine", "opdDays": "Monday to Saturday", "opdTimings": "9 am - 5 pm"},
    {"id": "doc-paed", "name": "Dr. Nusrat Parveen", "department": "Paediatrics", "qualification": "MD Paediatrics", "opdDays": "Monday, Thursday", "opdTimings": "10 am - 1 pm"},
]
CAMPS = [
    {"id": "camp-amour", "title": "Free eye check-up camp, Amour", "type": "eye", "date": "2026-11-14", "start": "10:00", "end": "14:00", "venue": "Amour High School", "block": "Amour", "departments": "Eye", "doctors": "Dr. Anjali Verma", "code": "AMR14"},
    {"id": "camp-kasba", "title": "Bone and joint camp, Kasba", "type": "bone_joint", "date": "2026-11-21", "start": "09:00", "end": "13:00", "venue": "Kasba Panchayat Bhawan", "block": "Kasba", "departments": "Orthopaedics", "doctors": "Dr. Imtiyaz Alam", "code": "KSB21"},
]
DIRECTORY = {
    "departments": DEPARTMENTS, "doctors": DOCTORS, "camps": CAMPS,
    "officeHours": {"on": True, "days": [1, 2, 3, 4, 5, 6], "start": "09:00", "end": "18:00"},
    "hospitalWhatsApp": "919431012345", "todayIst": "2026-11-09",
}
FACTS = {"text": "Glisan Hospital, Purnia. OPD Monday to Saturday. Emergency open 24 hours.", "phones": ["06454 222333", "9431012345"], "domains": []}
