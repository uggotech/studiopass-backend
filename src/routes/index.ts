import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { CountryRoutes } from "../module/country/country.route";
import { PartnerRoutes } from "../module/partner/partner.route";
import { StationRoutes } from "../module/station/station.route";
import { UserRoutes } from "../module/user/user.route";
import { LogsRoutes } from "../module/logs/logs.route";
import { FollowRoutes } from "../module/follow/follow.route";
import { ShowRoutes } from "../module/show/show.route";
import { CreditRoutes } from "../module/credit/credit.route";
import { MessageRoutes } from "../module/message/message.route";
import { MessageTemplateRoutes } from "../module/messageTemplate/messageTemplate.route";
import { ListenerStatementRoutes } from "../module/listenerStatement/listenerStatement.route";
import { PollRoutes } from "../module/poll/poll.route";
import { NotificationRoutes } from "../module/notification/notification.route";
import { StationApiKeyRoutes } from "../module/stationApiKey/stationApiKey.route";
import { DashboardRoutes } from "../module/dashboard/dashboard.route";
import { CallRoutes } from "../module/call/call.route";
import { StatusRoutes } from "../module/status/status.route";
import { ChallengeRoutes } from "../module/challenge/challenge.route";
import { ChannelPollRoutes } from "../module/channelPoll/channelPoll.route";
import { PrizeTypeRoutes } from "../module/prizeType/prizeType.route";
import { DisbursementRoutes } from "../module/disbursement/disbursement.route";
import { SupportRoutes } from "../module/support/support.route";

const router: Router = express.Router();

const apiRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/country", route: CountryRoutes },
  { path: "/partner", route: PartnerRoutes },
  { path: "/station", route: StationRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/show", route: ShowRoutes },
  { path: "/follow", route: FollowRoutes },
  { path: "/credit", route: CreditRoutes },
  { path: "/message", route: MessageRoutes },
  { path: "/call", route: CallRoutes },
  { path: "/logs", route: LogsRoutes },
  { path: "/message-template", route: MessageTemplateRoutes },
  { path: "/listener-statement", route: ListenerStatementRoutes },
  { path: "/poll", route: PollRoutes },
  { path: "/notification", route: NotificationRoutes },
  { path: "/station-api", route: StationApiKeyRoutes },
  { path: "/dashboard", route: DashboardRoutes },
  { path: "/status", route: StatusRoutes },
  { path: "/challenge", route: ChallengeRoutes },
  { path: "/channel-poll", route: ChannelPollRoutes },
  { path: "/prize-type", route: PrizeTypeRoutes },
  { path: "/disbursement", route: DisbursementRoutes },
  { path: "/support", route: SupportRoutes },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
