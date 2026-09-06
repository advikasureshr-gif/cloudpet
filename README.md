# 🐾 CloudPet — Intelligent Virtual Pet Assistant

CloudPet is a cloud-based intelligent virtual pet application
where users can create, care for, and interact with virtual pets.

## 🐾 Features

Users can:

- 🍖 Feed their pets
- 🎾 Play with their pets
- 🛁 Clean their pets
- 😴 Put pets to sleep
- 🧸 Buy items
- ❤️ Track happiness and health
- 🪙 Earn and spend coins
- 📈 Level up their pets
- 💬 Ask the pet assistant for advice

---

# ☁️ Cloud Architecture

CloudPet uses a hybrid AWS architecture combining
EC2-based application hosting with serverless,
event-driven processing.

```text
                         👤 USER
                            |
                            v
                     +-------------+
                     | CloudFront  |
                     +------+------+
                            |
                            v
                     +-------------+
                     |     S3      |
                     |  Frontend   |
                     +------+------+
                            |
                       API Requests
                            |
                            v
                     +-------------+
                     |     ALB     |
                     +------+------+
                            |
                   +--------+--------+
                   |                 |
                   v                 v
              +---------+       +---------+
              | EC2 #1  |       | EC2 #2  |
              | Backend |       | Backend |
              +----+----+       +----+----+
                   |                 |
                   +--------+--------+
                            |
                            v
                     +-------------+
                     |  DynamoDB   |
                     | Pet State   |
                     +-------------+

                    EVENT SYSTEM

                     EventBridge
                          |
                          v
                       Lambda
                          |
                  +-------+-------+
                  |               |
                  v               v
              DynamoDB           SNS
                                  |
                                  v
                                Email

                     CloudWatch
                   /     |      \
                 EC2   Lambda    ALB

                     Cognito
                        |
                        v
                  Authentication
