import { redirect } from 'next/navigation';

/** The old Hospital CRM board was replaced by the Referral pipeline. */
export default function OldHospitalCrmPage() {
  redirect('/admin/referrals');
}
