import { redirect } from 'next/navigation';

/** Partners moved to /admin/partners; keep old bookmarks working. */
export default function OldPipelinePage() {
  redirect('/admin/partners');
}
