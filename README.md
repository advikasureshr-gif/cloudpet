# 🐾 CloudPet — Intelligent Virtual Pet Assistant

CloudPet is a cloud-based intelligent virtual pet application where users can create, care for, and interact with virtual pets.

## 🐾 Features

Users can:

* 🍖 Feed their pets
* 🎾 Play with their pets
* 🛁 Clean their pets
* 😴 Put their pets to sleep
* 🧸 Buy items
* ❤️ Track happiness and health
* 🪙 Earn and spend coins
* 📈 Level up their pets
* 💬 Ask the pet assistant for advice

---

# ☁️ Cloud Architecture

CloudPet uses a hybrid AWS architecture combining **Amazon S3 and CloudFront for frontend delivery**, **Application Load Balancing and EC2 for backend hosting**, and **serverless, event-driven services for background processing and notifications**.

The architecture is designed to provide scalability, availability, secure authentication, persistent pet state, and asynchronous background processing.

```text
                                  👤 USER
                                     |
                                     v
                            +----------------+
                            |   CloudFront   |
                            +-------+--------+
                                    |
                    +---------------+---------------+
                    |                               |
                  /*                              /api/*
                    |                               |
                    v                               v
             +-------------+                 +-------------+
             |     S3      |                 |     ALB     |
             |  Frontend  |                 +------+------+ 
             +-------------+                        |
                                                    |
                                           +--------+--------+
                                           |                 |
                                           v                 v
                                     +----------+       +----------+
                                     |   EC2    |       |   EC2    |
                                     | Backend  |       | Backend  |
                                     +----+-----+       +----+-----+
                                          |                  |
                                          +--------+---------+
                                                   |
                                                   v
                                           +---------------+
                                           |   DynamoDB    |
                                           |   Pet State   |
                                           +---------------+


                         🔐 AUTHENTICATION

                              +-----------+
                              |  Cognito  |
                              +-----+-----+
                                    |
                              JWT / Tokens
                                    |
                                    v
                              Backend / API


                     ⚡ EVENT-DRIVEN PROCESSING

                              Backend
                                 |
                                 | Events
                                 v
                         +---------------+
                         |  EventBridge  |
                         +-------+-------+
                                 |
                       +---------+---------+
                       |                   |
                       v                   v
                 +-----------+       +-----------+
                 |  Lambda   |       |  Lambda   |
                 +-----+-----+       +-----+-----+
                       |                   |
                       v                   v
                  DynamoDB               SNS
                                           |
                                           v
                                         Email


                         📊 MONITORING

                            CloudWatch
                         /      |       \
                        v       v        v
                       EC2     ALB     Lambda
```

## 🏗️ Architecture Components

### 🌐 Frontend — S3 + CloudFront

The frontend application is hosted as static content in **Amazon S3** and distributed globally through **Amazon CloudFront**.

CloudFront handles frontend delivery and can route `/api/*` requests toward the backend Application Load Balancer while serving static frontend assets from S3.

### ⚖️ Backend — ALB + EC2

The application backend is hosted on multiple **Amazon EC2** instances behind an **Application Load Balancer (ALB)**.

The ALB distributes incoming API traffic across backend instances, improving availability and allowing the application to scale horizontally.

The EC2 instances can be managed through an **Auto Scaling Group** so that additional instances can be launched when demand increases.

### 🗄️ Database — DynamoDB

**Amazon DynamoDB** stores persistent application data such as:

* Pet state
* Happiness and health
* Hunger and energy
* Coins
* Experience and level
* Inventory
* User-specific pet information

DynamoDB provides a scalable NoSQL data store suitable for frequently changing game-state data.

### 🔐 Authentication — Cognito

**Amazon Cognito** provides user authentication and identity management.

After authentication, the frontend receives authentication tokens that are included with API requests. The backend validates the user's identity before accessing user-specific pet data.

### ⚡ Event-Driven Processing — EventBridge + Lambda

**Amazon EventBridge** is used to route application events to serverless processing functions.

Examples include:

* Processing pet-related background events
* Updating scheduled pet state
* Triggering secondary actions after user interactions
* Generating notifications
* Running periodic background tasks

**AWS Lambda** processes these events without requiring a continuously running server.

Core user actions such as feeding or playing with a pet can update DynamoDB directly through the backend for immediate feedback, while non-critical secondary processing can occur asynchronously through EventBridge and Lambda.

### 📩 Notifications — SNS

**Amazon SNS** can be used to publish notifications generated by background events.

For example, CloudPet could notify users about:

* Pet inactivity
* Important pet-state changes
* Scheduled reminders
* Other application events

SNS can deliver notifications through supported messaging and email channels.

### 📊 Monitoring — CloudWatch

**Amazon CloudWatch** provides monitoring and observability for the AWS infrastructure.

CloudWatch can monitor:

* EC2 instances
* ALB request metrics
* Lambda invocations and errors
* Application logs
* Performance metrics
* System alarms

This allows the application to detect failures and performance issues.

---

# 🔄 Request Flow

A typical frontend/API interaction follows this flow:

```text
User
  |
  v
CloudFront
  |
  +--------------------+
  |                    |
  v                    v
S3                   ALB
Frontend              |
                     v
                   EC2
                     |
                     v
                 DynamoDB
                     |
                     v
                  Response
                     |
                     v
                   User
```

For example, when a user feeds their pet:

```text
User clicks "Feed"
        |
        v
Frontend
        |
        v
CloudFront → ALB
        |
        v
Backend on EC2
        |
        v
DynamoDB
        |
        v
Updated pet state
        |
        v
Frontend updates immediately
```

If the action also generates a background event:

```text
Backend
   |
   +--------------------+
   |                    |
   v                    v
DynamoDB            EventBridge
                         |
                         v
                      Lambda
                         |
                    +----+----+
                    |         |
                    v         v
                 DynamoDB    SNS
                              |
                              v
                            Email
```

This separation keeps **user-facing operations synchronous and responsive**, while allowing secondary processing to happen asynchronously.

---

# 🔒 Security & Networking

The backend infrastructure is designed to run inside an **Amazon VPC**.

A typical deployment separates internet-facing and application resources:

```text
                         Internet
                            |
                            v
                          ALB
                            |
                 +----------+----------+
                 |                     |
                 v                     v
           Private Subnet        Private Subnet
                 |                     |
                 v                     v
              EC2 #1                EC2 #2
                 |                     |
                 +----------+----------+
                            |
                            v
                         DynamoDB
```

Security groups and IAM policies are used to restrict access between components and follow the principle of least privilege.

---

# ☁️ AWS Services Summary

| AWS Service                   | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| **Amazon S3**                 | Static frontend hosting                     |
| **Amazon CloudFront**         | CDN and frontend/API routing                |
| **Application Load Balancer** | Distributes API traffic                     |
| **Amazon EC2**                | Backend application hosting                 |
| **Auto Scaling**              | Horizontally scales backend instances       |
| **Amazon DynamoDB**           | Persistent pet/application state            |
| **Amazon Cognito**            | User authentication                         |
| **Amazon EventBridge**        | Event routing and scheduling                |
| **AWS Lambda**                | Serverless background processing            |
| **Amazon SNS**                | Notifications                               |
| **Amazon CloudWatch**         | Monitoring, logs, and alarms                |
| **Amazon VPC**                | Network isolation                           |
| **IAM**                       | AWS resource permissions and access control |

---

# 🎯 Architecture Goals

CloudPet's AWS architecture is designed around four main goals:

1. **Scalability** — EC2 Auto Scaling and managed AWS services allow the application to handle increasing demand.
2. **Availability** — Multiple backend instances behind an ALB reduce dependence on a single server.
3. **Responsiveness** — Core pet interactions are handled synchronously, while secondary workloads can be processed asynchronously.
4. **Cloud-Native Design** — The system combines traditional compute with managed and serverless AWS services to demonstrate both infrastructure and event-driven cloud architectures.
