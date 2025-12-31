# SCBHS Case Management System - Backend API

> A comprehensive RESTful API for managing cases, resources, meetings, and notifications in a behavioral health support system.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [User Roles](#user-roles)
- [License](#license)

---

## 🎯 Overview

SCBHS (School-Based Behavioral Health Support) is a comprehensive case management system designed to streamline the coordination between administrators, counselors, clinicians, and supervisors. The system provides tools for case management, resource sharing, meeting scheduling, and real-time notifications.

---

## 🛠 Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js with TypeScript
- **Database:** MongoDB with Mongoose ODM
- **Authentication:** JWT (JSON Web Tokens)
- **Validation:** Zod
- **File Storage:** AWS S3 (via Multer)
- **Notifications:** Firebase Cloud Messaging (FCM)
- **Email:** Nodemailer
- **Logging:** Pino
- **Security:** Helmet, CORS, Rate Limiting

---

## ✨ Features

### 🔐 Authentication & Authorization

- JWT-based authentication
- Role-based access control (RBAC)
- Email verification
- Password reset via email
- Secure password hashing

### 👥 User Management

- User CRUD operations
- Profile image upload to S3
- Role-based user filtering
- Pagination support

### 📋 Case Management

- Create, update, delete cases
- Case assignment to counselors/clinicians
- Case status tracking (Ongoing, Pending, In Progress, Complete)
- Auto-generated case numbers
- Filter cases by status, date, assignment
- Separate views for "My Cases" and "Available Cases"

### 📚 Resource Management

- Resource CRUD operations
- Bookmark/unbookmark resources
- Toggle bookmark feature
- Filter by category, location, service type
- Role-based resource visibility
- Notification on resource deletion (for bookmarked users)

### 📅 Meeting Management

- Supervisor creates meeting slots
- Counselor/Clinician booking system
- Support for 12-hour (AM/PM) and 24-hour time formats
- Meeting cancellation (with 30-min restriction)
- Meeting update functionality
- Separate meeting history for all roles
- Auto-completion of meetings based on end time
- Overlap detection

### 🔔 Notification System

- Real-time push notifications via FCM
- In-app notification history
- Unread notification count
- Mark as read functionality
- Notification triggers:
  - Case created → Notify Counselors & Clinicians
  - Resource created → Notify Counselors, Clinicians & Supervisors
  - Case assigned → Notify Admins & SuperAdmins
  - Resource deleted → Notify bookmarked users

### 📊 Dashboard

- Statistics overview for Admins
- Total users, active cases, resources count
- Role-specific user counts
- Recent activity feed

---

## 📁 Project Structure

```

```

src/
├── config/ # Configuration files (DB, HTTP status, Firebase)
├── enums/ # Enums (error codes, roles)
├── middlewares/ # Auth, error handling, validation, rate limiting
├── mailers/ # Email services
├── modules/ # Feature modules
│ ├── auth/ # Authentication
│ ├── user/ # User management
│ ├── case/ # Case management
│ ├── resource/ # Resource management
│ ├── meeting/ # Meeting scheduling
│ ├── notification/ # Notification system
│ ├── dashboard/ # Dashboard analytics
│ └── base/ # Base repository pattern
├── routes/ # API routes
├── services/ # External services (FCM, S3)
├── utils/ # Utility functions
└── app.ts # Express app entry point

```

```

## Project architecture pattern

   <img width="635" height="115" alt="image" src="https://github.com/user-attachments/assets/1c04a45c-9bbc-4a05-bc21-1212499baafc" />

## 🚀 Installation

### Prerequisites

- Node.js v18+
- MongoDB
- AWS S3 Account
- Firebase Account (for FCM)

### Steps

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/scbhs-backend.git
cd scbhs-backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Run the development server**

```bash
npm run dev
```

5. **Build for production**

```bash
npm run build
npm start
```

---

## 🔑 Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=4000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/scbhs

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_SECRET=your-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN=30d

# Email (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=noreply@scbhs.com

# AWS S3
AWS_REGION=ap-southeast-2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_PROFILE_IMAGES_BUCKET=scbhs-images-uploads-2025

# Firebase Cloud Messaging
FIREBASE_PROJECT_ID=scbhs-85801
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@scbhs-85801.iam.gserviceaccount.com

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

---

## 📖 API Documentation

### Base URL

```
http://localhost:4000/api/v1
```

### Authentication Endpoints

| Method | Endpoint                | Description            | Access        |
| ------ | ----------------------- | ---------------------- | ------------- |
| POST   | `/auth/register`        | Register new user      | Public        |
| POST   | `/auth/login`           | Login user             | Public        |
| POST   | `/auth/verify-email`    | Verify email           | Public        |
| POST   | `/auth/forgot-password` | Request password reset | Public        |
| POST   | `/auth/reset-password`  | Reset password         | Public        |
| POST   | `/auth/refresh-token`   | Refresh access token   | Public        |
| GET    | `/auth/me`              | Get current user       | Authenticated |

### User Endpoints

| Method | Endpoint                      | Description          | Access                  |
| ------ | ----------------------------- | -------------------- | ----------------------- |
| GET    | `/users`                      | Get all users        | Admin, SuperAdmin       |
| GET    | `/users/:id`                  | Get user by ID       | Admin, SuperAdmin       |
| POST   | `/users`                      | Create user          | Admin, SuperAdmin       |
| PUT    | `/users/:id`                  | Update user          | Admin, SuperAdmin, Self |
| DELETE | `/users/:id`                  | Delete user          | Admin, SuperAdmin       |
| POST   | `/users/profile/image-upload` | Upload profile image | Authenticated           |
| POST   | `/users/fcm-token`            | Update FCM token     | Authenticated           |

### Case Endpoints

| Method | Endpoint                 | Description         | Access               |
| ------ | ------------------------ | ------------------- | -------------------- |
| POST   | `/cases`                 | Create case         | Admin, SuperAdmin    |
| GET    | `/cases`                 | Get all cases       | Authenticated        |
| GET    | `/cases/my-cases`        | Get assigned cases  | Counselor, Clinician |
| GET    | `/cases/available-cases` | Get available cases | Counselor, Clinician |
| GET    | `/cases/:id`             | Get case by ID      | Authenticated        |
| PUT    | `/cases/:id`             | Update case         | Admin, SuperAdmin    |
| DELETE | `/cases/:id`             | Delete case         | Admin, SuperAdmin    |
| POST   | `/cases/:caseId/apply`   | Apply to case       | Counselor, Clinician |

### Resource Endpoints

| Method | Endpoint                         | Description              | Access                           |
| ------ | -------------------------------- | ------------------------ | -------------------------------- |
| POST   | `/resources`                     | Create resource          | Admin, SuperAdmin                |
| GET    | `/resources`                     | Get all resources        | Authenticated                    |
| GET    | `/resources/:id`                 | Get resource by ID       | Authenticated                    |
| PUT    | `/resources/:id`                 | Update resource          | Admin, SuperAdmin                |
| DELETE | `/resources/:id`                 | Delete resource          | Admin, SuperAdmin                |
| POST   | `/resources/:id/bookmark/toggle` | Toggle bookmark          | Supervisor, Counselor, Clinician |
| GET    | `/resources/bookmarks`           | Get bookmarked resources | Authenticated                    |

### Meeting Endpoints

| Method | Endpoint                               | Description                       | Access               |
| ------ | -------------------------------------- | --------------------------------- | -------------------- |
| POST   | `/meetings`                            | Create meeting slot               | Supervisor           |
| GET    | `/meetings/supervisor-meetings`        | Get all supervisor meetings       | Supervisor           |
| GET    | `/meetings/supervisor/meeting-history` | Get supervisor completed meetings | Supervisor           |
| PUT    | `/meetings/:meetingId`                 | Update meeting slot               | Supervisor           |
| DELETE | `/meetings/:meetingId`                 | Delete meeting slot               | Supervisor           |
| PUT    | `/meetings/zoom-link`                  | Update Zoom link                  | Supervisor           |
| GET    | `/meetings/available`                  | Get available meetings            | Counselor, Clinician |
| GET    | `/meetings/my-bookings`                | Get booked meetings               | Counselor, Clinician |
| GET    | `/meetings/meeting-history`            | Get meeting history               | Counselor, Clinician |
| POST   | `/meetings/:meetingId/book`            | Book meeting                      | Counselor, Clinician |
| PUT    | `/meetings/:meetingId/cancel`          | Cancel booking                    | Counselor, Clinician |

### Notification Endpoints

| Method | Endpoint                      | Description            | Access        |
| ------ | ----------------------------- | ---------------------- | ------------- |
| GET    | `/notifications`              | Get user notifications | Authenticated |
| GET    | `/notifications/unread-count` | Get unread count       | Authenticated |
| PATCH  | `/notifications/:id/read`     | Mark as read           | Authenticated |
| PATCH  | `/notifications/read-all`     | Mark all as read       | Authenticated |
| DELETE | `/notifications/:id`          | Delete notification    | Authenticated |

### Dashboard Endpoints

| Method | Endpoint              | Description         | Access            |
| ------ | --------------------- | ------------------- | ----------------- |
| GET    | `/dashboard/overview` | Get dashboard stats | Admin, SuperAdmin |

---

## 👥 User Roles

| Role           | Permissions                                                     |
| -------------- | --------------------------------------------------------------- |
| **SuperAdmin** | Full system access, user management, case & resource management |
| **Admin**      | User management (except SuperAdmin), case & resource management |
| **Supervisor** | Create/manage meeting slots, view meeting history               |
| **Counselor**  | View/apply to cases, book meetings, bookmark resources          |
| **Clinician**  | View/apply to cases, book meetings, bookmark resources          |

---

## 📝 Example API Requests

### Register User

```bash
POST /api/v1/auth/register
Content-Type: application/json

{
  "fullName": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "role": "Counselor"
}
```

### Create Case

```bash
POST /api/v1/cases
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "title": "Child Counseling",
  "description": "Individual therapy for anxiety",
  "startDate": "2025-11-01",
  "endDate": "2025-12-01",
  "client": {
    "fullName": "Jane Smith",
    "age": 15,
    "gender": "Female",
    "phone": "555-1234",
    "emergencyContact": "555-5678",
    "email": "parent@example.com",
    "address": "123 Main St"
  }
}
```

### Create Meeting Slot (12-hour format)

```bash
POST /api/v1/meetings
Authorization: Bearer <supervisor-token>
Content-Type: application/json

{
  "date": "2025-11-05",
  "startTime": "2:00 PM",
  "endTime": "3:00 PM"
}
```

### Book Meeting

```bash
POST /api/v1/meetings/:meetingId/book
Authorization: Bearer <counselor-token>
```

---

## 🔒 Security Features

- **Helmet.js** for securing HTTP headers
- **CORS** with configurable origins
- **Rate Limiting** to prevent abuse
- **JWT** with refresh token rotation
- **Password Hashing** using bcrypt
- **Input Validation** using Zod
- **SQL Injection Prevention** via Mongoose
- **XSS Protection** via sanitization

---

## 📧 Email Templates

The system includes professional email templates for:

- Email verification
- Password reset
- Welcome emails
- Case assignment notifications

---

## 📱 Push Notifications

Integrated Firebase Cloud Messaging for:

- Real-time case updates
- Resource notifications
- Meeting reminders
- System alerts

---

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Your Name**

- GitHub: [@yourusername](https://github.com/yourusername)
- Email: your.email@example.com

---

## 🙏 Acknowledgments

- Express.js community
- MongoDB team
- Firebase team
- All contributors

---

## 📞 Support

For support, email support@scbhs.com or open an issue in the repository.

---

**Built with ❤️ for School-Based Behavioral Health Support**
