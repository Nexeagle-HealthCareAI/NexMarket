import { redirect } from 'next/navigation';

/** Panchayat records now live in Panchayat coverage (Record tab, Add panchayat, scope per block). */
export default function OldPanchayatsPage() {
  redirect('/admin/coverage');
}
