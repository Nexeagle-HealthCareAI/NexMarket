// Words for the camp booking page people open from the QR poster. Hindi first: most people scanning read it best.
export type Lang = 'hi' | 'en' | 'bn';
export const LANGS: { key: Lang; label: string }[] = [{ key: 'hi', label: 'हिंदी' }, { key: 'en', label: 'English' }, { key: 'bn', label: 'বাংলা' }];

const en = {
  free: 'Free check-up',
  placesLeft: '{n} places left',
  today: 'Today',
  doctors: 'Doctors',
  map: 'Open in Maps',
  formTitle: 'Book your place',
  formSub: 'Takes one minute. You get a token number to show at the camp.',
  name: 'Full name',
  namePh: 'e.g. Rafiya Khatoon',
  age: 'Age',
  agePh: 'Years',
  gender: 'Gender',
  male: 'Male',
  female: 'Female',
  other: 'Other',
  mobile: 'Mobile number',
  optional: 'optional',
  mobileHint: 'So the hospital can remind you. Not shared with anyone.',
  village: 'Village / Panchayat',
  villagePh: 'Type your village or panchayat',
  problem: 'What is the problem?',
  problemHint: 'Tap any that apply (optional)',
  otherPh: 'Anything else? Write it here (optional)',
  consent: 'The hospital may call me about my health check-up',
  book: 'Book my place',
  booking: 'Booking…',
  doneTitle: 'Your place is booked',
  token: 'Token number',
  showThis: 'Show this number at the camp registration desk.',
  saveTip: 'Take a screenshot of this page to keep the number.',
  shareWa: 'Send to my WhatsApp',
  another: 'Book for another person',
  yourTokens: 'Booked from this phone',
  already: 'Already booked earlier with this name and mobile.',
  needName: 'Write the name.',
  needAge: 'Write the age (in years).',
  needSex: 'Choose male, female or other.',
  needPhone: 'The mobile number should have 10 digits.',
  needVillage: 'Write the village or panchayat.',
  failed: 'Could not book. Check the internet and try again.',
  tooMany: 'Too many bookings from this network just now. Wait a few minutes and try again.',
  notFound: 'This camp was not found. Check the QR code, or ask the camp team.',
  cancelled: 'This camp was cancelled.',
  over: 'This camp is over. Watch for the next camp near you.',
  full: 'All places are booked.',
  fullSub: 'You can still come to the camp; you may have to wait. Call to ask:',
  call: 'Call the hospital',
  shareText: 'My token for {camp}: {token}. {when}, {where}.',
  bring: 'Bring your old reports and medicines, if any.',
  loading: 'Opening…',
};
type Keys = keyof typeof en;

const hi: Record<Keys, string> = {
  free: 'निःशुल्क जांच',
  placesLeft: '{n} जगह बाकी',
  today: 'आज',
  doctors: 'डॉक्टर',
  map: 'नक्शे में देखें',
  formTitle: 'अपनी जगह बुक करें',
  formSub: 'बस एक मिनट। आपको टोकन नंबर मिलेगा, शिविर में दिखाएं।',
  name: 'पूरा नाम',
  namePh: 'जैसे: रफ़िया ख़ातून',
  age: 'उम्र',
  agePh: 'साल',
  gender: 'लिंग',
  male: 'पुरुष',
  female: 'महिला',
  other: 'अन्य',
  mobile: 'मोबाइल नंबर',
  optional: 'ज़रूरी नहीं',
  mobileHint: 'ताकि अस्पताल आपको याद दिला सके। किसी और को नहीं दिया जाता।',
  village: 'गांव / पंचायत',
  villagePh: 'अपना गांव या पंचायत लिखें',
  problem: 'क्या तकलीफ़ है?',
  problemHint: 'जो लागू हो उस पर टैप करें (ज़रूरी नहीं)',
  otherPh: 'और कुछ? यहां लिखें (ज़रूरी नहीं)',
  consent: 'अस्पताल मेरी जांच के बारे में मुझे फ़ोन कर सकता है',
  book: 'मेरी जगह बुक करें',
  booking: 'बुक हो रहा है…',
  doneTitle: 'आपकी जगह बुक हो गई',
  token: 'टोकन नंबर',
  showThis: 'शिविर के रजिस्ट्रेशन डेस्क पर यह नंबर दिखाएं।',
  saveTip: 'नंबर याद रखने के लिए इस पेज का स्क्रीनशॉट ले लें।',
  shareWa: 'मेरे WhatsApp पर भेजें',
  another: 'दूसरे व्यक्ति के लिए बुक करें',
  yourTokens: 'इस फ़ोन से बुक किए',
  already: 'इस नाम और मोबाइल से पहले ही बुक हो चुका है।',
  needName: 'नाम लिखें।',
  needAge: 'उम्र लिखें (साल में)।',
  needSex: 'पुरुष, महिला या अन्य चुनें।',
  needPhone: 'मोबाइल नंबर 10 अंकों का होना चाहिए।',
  needVillage: 'गांव या पंचायत लिखें।',
  failed: 'बुक नहीं हो पाया। इंटरनेट देखें और फिर से कोशिश करें।',
  tooMany: 'इस नेटवर्क से अभी बहुत बुकिंग हुई हैं। कुछ मिनट रुककर फिर कोशिश करें।',
  notFound: 'यह शिविर नहीं मिला। QR कोड देखें या शिविर टीम से पूछें।',
  cancelled: 'यह शिविर रद्द हो गया है।',
  over: 'यह शिविर ख़त्म हो चुका है। अपने पास अगले शिविर का इंतज़ार करें।',
  full: 'सारी जगह बुक हो चुकी हैं।',
  fullSub: 'आप फिर भी शिविर में आ सकते हैं, थोड़ा इंतज़ार करना पड़ सकता है। पूछने के लिए फ़ोन करें:',
  call: 'अस्पताल को फ़ोन करें',
  shareText: '{camp} के लिए मेरा टोकन: {token}। {when}, {where}।',
  bring: 'पुरानी रिपोर्ट और दवाइयां हों तो साथ लाएं।',
  loading: 'खुल रहा है…',
};

const bn: Record<Keys, string> = {
  free: 'বিনামূল্যে পরীক্ষা',
  placesLeft: '{n}টি জায়গা বাকি',
  today: 'আজ',
  doctors: 'ডাক্তার',
  map: 'ম্যাপে দেখুন',
  formTitle: 'আপনার জায়গা বুক করুন',
  formSub: 'এক মিনিট লাগবে। একটি টোকেন নম্বর পাবেন, শিবিরে দেখাবেন।',
  name: 'পুরো নাম',
  namePh: 'যেমন: রফিয়া খাতুন',
  age: 'বয়স',
  agePh: 'বছর',
  gender: 'লিঙ্গ',
  male: 'পুরুষ',
  female: 'মহিলা',
  other: 'অন্য',
  mobile: 'মোবাইল নম্বর',
  optional: 'দরকার নেই',
  mobileHint: 'যাতে হাসপাতাল আপনাকে মনে করিয়ে দিতে পারে। কাউকে দেওয়া হয় না।',
  village: 'গ্রাম / পঞ্চায়েত',
  villagePh: 'আপনার গ্রাম বা পঞ্চায়েত লিখুন',
  problem: 'কী সমস্যা?',
  problemHint: 'যেগুলো প্রযোজ্য তাতে ট্যাপ করুন (দরকার নেই)',
  otherPh: 'আর কিছু? এখানে লিখুন (দরকার নেই)',
  consent: 'হাসপাতাল আমার পরীক্ষার বিষয়ে আমাকে ফোন করতে পারে',
  book: 'আমার জায়গা বুক করুন',
  booking: 'বুক হচ্ছে…',
  doneTitle: 'আপনার জায়গা বুক হয়েছে',
  token: 'টোকেন নম্বর',
  showThis: 'শিবিরের রেজিস্ট্রেশন ডেস্কে এই নম্বর দেখান।',
  saveTip: 'নম্বর রাখতে এই পেজের স্ক্রিনশট নিন।',
  shareWa: 'আমার WhatsApp-এ পাঠান',
  another: 'অন্য কারও জন্য বুক করুন',
  yourTokens: 'এই ফোন থেকে বুক করা',
  already: 'এই নাম ও মোবাইল দিয়ে আগেই বুক হয়েছে।',
  needName: 'নাম লিখুন।',
  needAge: 'বয়স লিখুন (বছরে)।',
  needSex: 'পুরুষ, মহিলা বা অন্য বেছে নিন।',
  needPhone: 'মোবাইল নম্বর ১০ সংখ্যার হতে হবে।',
  needVillage: 'গ্রাম বা পঞ্চায়েত লিখুন।',
  failed: 'বুক করা গেল না। ইন্টারনেট দেখে আবার চেষ্টা করুন।',
  tooMany: 'এই নেটওয়ার্ক থেকে এখন অনেক বুকিং হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
  notFound: 'এই শিবির পাওয়া যায়নি। QR কোড দেখুন বা শিবিরের দলকে জিজ্ঞেস করুন।',
  cancelled: 'এই শিবির বাতিল হয়েছে।',
  over: 'এই শিবির শেষ হয়ে গেছে। কাছের পরের শিবিরের অপেক্ষা করুন।',
  full: 'সব জায়গা বুক হয়ে গেছে।',
  fullSub: 'আপনি তবুও শিবিরে আসতে পারেন, একটু অপেক্ষা করতে হতে পারে। জানতে ফোন করুন:',
  call: 'হাসপাতালে ফোন করুন',
  shareText: '{camp}-এর জন্য আমার টোকেন: {token}। {when}, {where}।',
  bring: 'পুরনো রিপোর্ট ও ওষুধ থাকলে সঙ্গে আনুন।',
  loading: 'খুলছে…',
};

export const TEXT: Record<Lang, Record<Keys, string>> = { en, hi, bn };
export type TextKey = Keys;

/** Common problems people come to each kind of camp with, as one-tap chips. */
const P = (en: string, hi: string, bn: string) => ({ en, hi, bn });
const COMMON = [P('BP', 'बीपी', 'রক্তচাপ'), P('Sugar', 'शुगर', 'সুগার'), P('Fever', 'बुखार', 'জ্বর'), P('Weakness', 'कमज़ोरी', 'দুর্বলতা')];
export const PROBLEMS: Record<string, { en: string; hi: string; bn: string }[]> = {
  bone_joint: [P('Knee pain', 'घुटने का दर्द', 'হাঁটুর ব্যথা'), P('Back pain', 'कमर दर्द', 'কোমরের ব্যথা'), P('Joint pain', 'जोड़ों का दर्द', 'গাঁটে ব্যথা'), P('Neck pain', 'गर्दन दर्द', 'ঘাড়ে ব্যথা'), P('Shoulder pain', 'कंधे का दर्द', 'কাঁধে ব্যথা'), P('Old injury', 'पुरानी चोट', 'পুরনো আঘাত')],
  eye: [P('Blurred vision', 'धुंधला दिखना', 'ঝাপসা দেখা'), P('Cataract', 'मोतियाबिंद', 'ছানি'), P('Eye pain', 'आंख में दर्द', 'চোখে ব্যথা'), P('Watery / red eyes', 'आंख से पानी / लाली', 'চোখ দিয়ে জল / লাল'), P('Need glasses', 'चश्मा चाहिए', 'চশমা দরকার')],
  women: [P('Irregular periods', 'माहवारी अनियमित', 'অনিয়মিত মাসিক'), P('Pregnancy check-up', 'गर्भावस्था जांच', 'গর্ভাবস্থা পরীক্ষা'), P('White discharge', 'सफ़ेद पानी', 'সাদা স্রাব'), P('Lower belly pain', 'पेट के निचले हिस्से में दर्द', 'তলপেটে ব্যথা'), P('Anaemia', 'खून की कमी', 'রক্তাল্পতা')],
  diabetes_bp: [P('High sugar', 'शुगर ज़्यादा', 'সুগার বেশি'), P('High BP', 'बीपी ज़्यादा', 'রক্তচাপ বেশি'), P('Dizziness', 'चक्कर आना', 'মাথা ঘোরা'), P('Headache', 'सिर दर्द', 'মাথাব্যথা'), P('Numb feet', 'पैर सुन्न होना', 'পা অবশ')],
  child: [P('Fever', 'बुखार', 'জ্বর'), P('Cough / cold', 'खांसी / ज़ुकाम', 'কাশি / সর্দি'), P('Loose motions', 'दस्त', 'পাতলা পায়খানা'), P('Not gaining weight', 'वज़न नहीं बढ़ रहा', 'ওজন বাড়ছে না'), P('Vaccination', 'टीकाकरण', 'টিকা')],
  dental: [P('Toothache', 'दांत दर्द', 'দাঁতে ব্যথা'), P('Bleeding gums', 'मसूड़ों से खून', 'মাড়ি থেকে রক্ত'), P('Cavity', 'दांत में कीड़ा', 'দাঁতে পোকা'), P('Bad breath', 'मुंह से बदबू', 'মুখে দুর্গন্ধ')],
  heart: [P('Chest pain', 'सीने में दर्द', 'বুকে ব্যথা'), P('Breathlessness', 'सांस फूलना', 'শ্বাসকষ্ট'), P('High BP', 'बीपी ज़्यादा', 'রক্তচাপ বেশি'), P('Swollen feet', 'पैरों में सूजन', 'পা ফোলা'), P('Palpitations', 'धड़कन तेज़', 'বুক ধড়ফড়')],
  general: [P('Fever', 'बुखार', 'জ্বর'), P('BP', 'बीपी', 'রক্তচাপ'), P('Sugar', 'शुगर', 'সুগার'), P('Stomach pain', 'पेट दर्द', 'পেটে ব্যথা'), P('Cough', 'खांसी', 'কাশি'), P('Joint pain', 'जोड़ों का दर्द', 'গাঁটে ব্যথা'), P('Skin problem', 'त्वचा की समस्या', 'চামড়ার সমস্যা')],
};
export const problemsFor = (type: string) => PROBLEMS[type] ?? [...PROBLEMS.general, ...COMMON.filter((c) => !PROBLEMS.general.some((g) => g.en === c.en))];

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
};
const DAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
  bn: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
};
export function dateParts(ymd: string, lang: Lang) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { day: d, month: MONTHS[lang][m - 1], weekday: DAYS[lang][dt.getUTCDay()] };
}

/** "9:00 am" from "09:00". */
export function clock(hhmm: string, lang: Lang) {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  if (lang === 'en') return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  const part = lang === 'hi' ? (h < 12 ? 'सुबह' : h < 16 ? 'दोपहर' : 'शाम') : (h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : 'বিকেল');
  return `${part} ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
