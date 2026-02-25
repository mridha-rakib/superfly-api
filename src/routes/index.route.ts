import authRouter from "@/modules/auth/auth.route";
import billingRouter from "@/modules/billing/billing.route";
import cleaningServiceRouter from "@/modules/cleaning-service/cleaning-service.route";
import cleaningReportRouter from "@/modules/cleaning-report/cleaning-report.route";
import contactRouter from "@/modules/contact/contact.route";
import dashboardRouter from "@/modules/dashboard/dashboard.route";
import quoteRouter from "@/modules/quote/quote.route";
import reviewRouter from "@/modules/review/review.route";
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
    path: "/dashboard",
    route: dashboardRouter,
  },
  {
    path: "/contact",
    route: contactRouter,
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
    path: "/reviews",
    route: reviewRouter,
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
