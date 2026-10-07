import { api } from './client';
export interface SkipInsight { id:number;empCode:string;fullName:string;assigned:number;requests:number;automatic:number;pending:number;approved:number;rejected:number;cohortSkipped:number;outsideCohort:number;skipRate:number|null }
export interface DailyDesignRow {date:string;employeeId:number;empCode:string;fullName:string;completed:number;issued:number;skipped:number|null;pending:number|null;notFound:number|null;events:number|null;copyright:number|null;replacementIssued:number;replacementOwed:number}
export interface DailyDesignReport {from:string;to:string;skipHistoryCompleteFrom:string;definition:string;rows:DailyDesignRow[]}
export interface SkipReport {from:string;to:string;historySince:string|null;definition:string;rows:SkipInsight[]}
export interface HistoryEvent {id:number;action:string;actorName:string|null;source:string;recordedAt:string;beforeState:Record<string,unknown>|null;afterState:Record<string,unknown>}
export interface TargetHistory {target:{id:number;asin:string;jobNumber:number|null;status:string};historySince:string|null;rows:HistoryEvent[];nextBefore:number|null}
export const getSkipInsights=(from:string,to:string,signal?:AbortSignal)=>api<SkipReport>(`/target-insights/skips?${new URLSearchParams({from,to})}`,{signal});
export const getDailyDesignReport=(from:string,to:string,signal?:AbortSignal)=>api<DailyDesignReport>(`/target-insights/daily?${new URLSearchParams({from,to})}`,{signal});
export const getTargetHistory=(id:number,before?:number,signal?:AbortSignal)=>api<TargetHistory>(`/target-insights/${id}/history${before?`?before=${before}`:''}`,{signal});
