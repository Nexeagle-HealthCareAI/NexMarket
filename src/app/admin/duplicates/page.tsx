import { redirect } from 'next/navigation';

/** Duplicate review is now a tab on the Partners page. */
export default function OldDuplicatesPage() {
  redirect('/admin/partners?tab=dup');
}
