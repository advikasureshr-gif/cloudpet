# CloudPet Architecture

This document describes the cloud architecture of the
CloudPet Intelligent Virtual Pet Assistant.

## Architecture

```text
                    USER
                      |
                      v
                 CloudFront
                      |
                      v
                     S3
                 Frontend
                      |
                 API Requests
                      |
                      v
                    ALB
                      |
              +-------+-------+
              |               |
              v               v
           EC2 #1           EC2 #2
           Backend          Backend
              |               |
              +-------+-------+
                      |
                      v
                  DynamoDB


              EventBridge
                   |
                   v
                 Lambda
                /      \
               v        v
          DynamoDB      SNS
                         |
                         v
                       Email

              Cognito
                  |
                  v
             Authentication

             CloudWatch
                  |
                  v
              Monitoring
