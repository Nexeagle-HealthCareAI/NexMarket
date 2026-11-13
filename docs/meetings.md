# Meetings in chat

A meeting is a group call planned for a chat, with optional AI notes.

## How it works

1. **Plan** (office only): in a chat on the CRM, the calendar button in the header. Name, day and time, length,
   points to cover, video or voice. Everyone who can use that chat is told at once and reminded 10 minutes before.
   The chat gets a line ("Meeting planned: …"). A meeting that hasn't started can be changed or cancelled.
2. **Join**: the meeting shows under the chat's header on the CRM and in the phone app. The room opens 15 minutes
   early; the first person in starts it and the others get "Meeting started: tap to join". It is an ordinary
   NexEagle call (LiveKit), so calling must be switched on.
3. **AI notes** are off unless someone in the office turns them on during the meeting (the "AI notes" button in the
   call window on the CRM). Then:
   - everyone in the call sees a banner within seconds, on the CRM and on phones, and the chat gets a line saying
     who turned them on;
   - that office person's browser mixes everyone's voice, cuts it into one-minute pieces and sends each piece to the
     server, which passes it to the speech service (Groq) and keeps only the text. The sound is never saved;
   - turning them off, leaving, or ending the meeting sends the last piece.
4. **After the meeting**, if anything was heard, the AI writes the minutes from the text (summary, points, decisions,
   actions). Phones, IDs, emails and patient names are hidden before the text goes to the AI and put back in its
   answer. The result:
   - a document in **Team board → Plans & docs**, project "Meetings";
   - a short version posted in the chat;
   - one Team board card per action, given to its owner when the name said matches exactly one person in the meeting.
   Every one of these says it was written by AI and should be checked.

## Limits and things to know

- AI notes need one office person in the meeting **on the CRM in Chrome or Edge**. A meeting with only phones in
  it cannot be listened to. If that person's computer loses its connection, the minutes they missed are missed.
- At most four hours of one meeting are listened to. The transcript is kept (office only) so notes can be written
  again with "Try again" if the AI fails; it is tried three times on its own first.
- Speakers are not told apart in the transcript, and Hindi and English mixed speech can be misheard.
- Settings: calling (`LiveKit__*`) and the Groq key (`Groq__ApiKey`). No new settings.
- Database: table `marketing.meetings` (migration `AddMeetings`).

## Where the code is

- Server: `Services/Meetings.cs` (`MeetingRules`, `MeetingsController`, `MeetingWorker`), minutes in
  `ChatAiService.MinutesAsync`, and `CallKinds.IsRoom` in `Services/Calls.cs`.
- CRM: `src/lib/crm/meetings.ts` (`NotesListener`), `src/components/crm/chat/Meetings.tsx`, the call window.
- Phone app: `joinMeeting`, `ChatMeetings` in `components/CallParts.tsx`, the banner in `app/call/[id].tsx`.
