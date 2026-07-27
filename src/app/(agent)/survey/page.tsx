import { Metadata } from 'next';
import SurveyClient from './SurveyClient';

export const metadata: Metadata = {
  title: 'Survey | NexMarket',
};

export default function SurveyPage() {
  return <SurveyClient />;
}
