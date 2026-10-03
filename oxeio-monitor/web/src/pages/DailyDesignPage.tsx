import { Page } from '../components/Page';
import { DailyDesignInsights } from './targets/Insights';

export function DailyDesignPage() {
  return <Page title="Daily designs & skips" subtitle="Daily completed designs, skip decisions and pending reviews by staff">
    <DailyDesignInsights />
  </Page>;
}
