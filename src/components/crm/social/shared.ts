export interface SocialStatus {
  connected: boolean; page?: string | null; instagram?: string | null; adAccount?: string | null; hasAds: boolean; currency?: string | null;
  unread: number; formsToday: number; canManage: boolean; isAdmin: boolean; me: string;
}

export const CHANNEL_LABEL: Record<string, string> = { messenger: 'Facebook', instagram: 'Instagram' };
export const LEAD_LABEL: Record<string, string> = { new: 'New lead', contacted: 'Contacted', appointment: 'Appointment', arrived: 'Arrived', admitted: 'Admitted', lost: 'Not interested' };

const istTimeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istDayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
export const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const istTime = (iso: string) => istTimeFmt.format(new Date(iso));
export function when(iso: string) {
  return istDay(iso) === istDay(new Date().toISOString()) ? istTimeFmt.format(new Date(iso)) : istDayFmt.format(new Date(iso));
}
export function dayLabel(iso: string) {
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? 'Today' : d === y ? 'Yesterday' : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
export const showPhone = (p?: string | null) => (!p ? '' : p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p);

export function moneyFmt(currency?: string | null, digits = 2) {
  try { if (currency) return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: digits }); } catch { /* unknown code */ }
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits });
}
