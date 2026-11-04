import { redirect } from 'next/navigation';

/** Moved: everything WhatsApp is now on one page. */
export default function Moved() {
  redirect('/admin/whatsapp?tab=broadcasts');
}
