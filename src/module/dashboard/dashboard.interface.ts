export interface DashboardStats {
  totalPartners: number;
  activePartners: number;
  totalStations: number;
  activeStations: number;
  totalUsers: number;
  totalMessages: number;
  totalCalls: number;
  totalRevenue: number;
}

export interface MessageActivityPoint {
  date: string;
  count: number;
}

export interface StationOverviewRow {
  stationId: string;
  stationName: string;
  country: string;
  activeShows: number;
  messagesToday: number;
  status: string;
}

export interface ActivityItem {
  type: string;
  description: string;
  timestamp: Date;
  user?: string;
}

export interface TopStationRow {
  stationId: string;
  stationName: string;
  messageCount: number;
}

export interface RecentUserRow {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  station: string;
  status: string;
  createdAt: Date;
}

export interface CreditStats {
  creditsPurchased: number;
  creditsUsed: number;
  successfulTxns: number;
  failedTxns: number;
  totalRevenue: number;
}

export interface CountryRevenueRow {
  countryId: string;
  countryName: string;
  stations: number;
  messages: number;
  revenue: number;
}
