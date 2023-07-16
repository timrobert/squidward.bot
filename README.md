# squidward.bot
CLSA Bot - Originally for WeeklyEmail, but maybe later for Discord Bot?

## Introduction
WildApricot can send individual event reminders and registrations.  But these event reminders can become noisy and so many people ignore them or unsubscribe.  CLSA club members expressed an interest in having a weekly events summary email that would be sent the weekend before to advise them of the weeks upcoming events.  

## Requirements
1. Weekly email summary of upcoming events.
2. Email be short and concise (easily read on a phone without scrolling)
3. Do not list days for which there a no events
4. Do not send the email if there are no events for the upcoming week.
    - in deep winter there are often no-event weeks, and a "no events" email would be of no use.
5. Solution should be automated so that it does not take admin time to send/trigger the email
6. Solution should compile the list of events from the CLSA Wild Apricot system
7. Solution should send all events to all eligible members
8. Solution should allow members to "unsubscribe" from the weekly email
9. Solution should send email to members who meet all of the following criteria:
    - Active memberships
    - member is subscribed to the weekly email list
10. Each event should list all of the following:
    - Day of week of the event
    - Date and time of the event
    - a link to the CLSA website for more details on the event
11. Email must also include the Wild Apricot `{unsubscribe}` tag.
12. Email must include link to the full CLSA events Calendar
13. Email must include link or instuctions on how to unsubscribe from the weekly email
14. Email should have a friendly and nautical tone

## Technical details
Uses the Wild Apricot API.
  - https://gethelp.wildapricot.com/en/articles/502-contacts-admin-api-call#filtering
  - https://gethelp.wildapricot.com/en/articles/499-events-admin-api-call
  - https://app.swaggerhub.com/apis-docs/WildApricot/wild-apricot_public_api/7.24.0#/Events/GetEventsList
  - https://app.swaggerhub.com/apis-docs/WildApricot/wild-apricot_public_api/7.24.0#/Emailing.Operations/SendEmail

## Setup

### Environment
To run will require two environment variables.
```shell
export SQUIDWARD_SECRET="[OAuth Base64 Encoded Wild Apricot Secret]"
export SQUIDWARD_CLSAACCNTNUM="[Wild Apricot Account Number]"
```

### Install Software
1. install Brew
2. use brew to install git
3. clone down the Squidward app
4. use brew to install NPM
5. use brew to install nodejs
6. npm install axios

### Schedule the Job
You can then run the job manually.
Or (preferably) to run the job on a schedule via a `cron` job.

```shell
0 17 * * 6 node /YOUR/APP/PATH/squidward.bot/weeklyEmailBlast.js >> /YOUR/APP/PATH/squidward.bot/logs/cron_$(date '+%Y-%m-%d-%H-%M-%S').log 2>&1
```
