type ChartValues = {completed:number;skipped:number};

export function chartMaximum(days:readonly ChartValues[]):number{
 return Math.max(1,...days.flatMap(day=>[day.completed,day.skipped]));
}

export function chartBarHeight(value:number,maximum:number):number{
 return value<=0?0:Math.min(100,Math.max(5,value/maximum*100));
}
