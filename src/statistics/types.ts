export interface StatisticsRepository { counts(): Promise<{ countries: number; universities: number; scholarships: number; programs: number }> }
