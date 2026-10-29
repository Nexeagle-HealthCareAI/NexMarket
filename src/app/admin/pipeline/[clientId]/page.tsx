import { redirect } from 'next/navigation';

/** Old partner profile URL — the profile now opens beside the Partners list. */
export default async function OldContactProfilePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  redirect(`/admin/partners?id=${encodeURIComponent(clientId)}`);
}
