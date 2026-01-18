import authRouter from "@/modules/auth/auth.route";
import billingRouter from "@/modules/billing/billing.route";
import cleaningServiceRouter from "@/modules/cleaning-service/cleaning-service.route";
import cleaningReportRouter from "@/modules/cleaning-report/cleaning-report.route";
import quoteRouter from "@/modules/quote/quote.route";
import userRouter from "@/modules/user/user.route";

import { Router } from "express";

const router = Router();

const moduleRoutes = [
  {
    path: "/auth",
    route: authRouter,
  },
  {
    path: "/billing",
    route: billingRouter,
  },
  {
    path: "/services",
    route: cleaningServiceRouter,
  },
  {
    path: "/reports",
    route: cleaningReportRouter,
  },
  {
    path: "/quotes",
    route: quoteRouter,
  },
  {
    path: "/user",
    route: userRouter,
  },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
