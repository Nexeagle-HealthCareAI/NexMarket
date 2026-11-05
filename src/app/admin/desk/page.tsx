import { redirect } from 'next/navigation';

/** The Referral desk is now the "Front desk" tab of the combined Referrals board. */
export default function OldReferralDeskPage() {
  redirect('/admin/referrals?tab=desk');
}
