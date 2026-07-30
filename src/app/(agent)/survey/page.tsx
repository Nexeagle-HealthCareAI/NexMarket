import { Metadata } from 'next';
import { Suspense } from 'react';
import SurveyClient from './SurveyClient';

export const metadata: Metadata = {
  title: 'Survey | NexMarket',
};

export default function SurveyPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: 'white' }}>Loading Survey...</div>}>
      <SurveyClient />
    </Suspense>
  );
}
