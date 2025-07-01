const axios = require('axios');
const fs = require('node:fs');


async function getToken(waSecret) {
  console.log("Get Wild Apricot Token...");
  const tokenUrl = "https://oauth.wildapricot.org/auth/token";
  const tokenConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + waSecret,
      "Connection": "keep-alive"
    }
  };
  const tokenData = {
    "grant_type": "client_credentials",
    "scope": "auto"
  }
  try {
    const reqToken = await axios.post(tokenUrl, tokenData, tokenConfig)
    console.log("\tOK.");
    return reqToken.data.access_token;
  } catch (err) {
    throw new Error('Unable to aquire access token: ' + err);
  }
}

async function getMembers(waToken, waApiVersion, waAccountNumber, waEmailGroupNumber) {
  console.log("Get email recipients...");
  const usersUrl = "https://api.wildapricot.org/" + waApiVersion + "/accounts/" + waAccountNumber + "/Contacts?$async=false&$filter=Status eq Active";
  const usersConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + waToken
    }
  };

  const blastGroupUrl = "https://api.wildapricot.org/" + waApiVersion + "/accounts/" + waAccountNumber + "/membergroups/" + waEmailGroupNumber;
  const blastGroupConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + waToken
    }
  };

  try {
    const resContacts = await axios.get(usersUrl, usersConfig);
    const resWeeklyEmailBlastMembers = await axios.get(blastGroupUrl, blastGroupConfig);

    //filter, selecting only members who are in the WeeklyEmailBlast group
    const contacts = resContacts.data.Contacts;
    const blastGroupMemberIds = resWeeklyEmailBlastMembers.data.ContactIds;
    const filteredContacts = contacts.filter(function (contact) {
      return blastGroupMemberIds.includes(contact.Id);
    });

    console.log("\tOK.");
    return filteredContacts;
  } catch (err) {
    throw new Error('Error getting users: ' + err);
  }
}

function buildRecipientsList(members) {
  console.log("Build recipients list...");
  const recipients = [];
  members.forEach(function (member) {
    recipients.push({
      "Id": member.Id,
      "Type": "IndividualContactRecipient", //This is just a static value
      "Name": member.FirstName + " " + member.LastName,
      "Email": member.Email
    });
  });
  console.log("\tOK.");
  return recipients;
}

async function getThisWeeksEvents(waToken, waApiVersion, waAccountNumber) {
  try {
    console.log("Get events list...");
    const emailWindowStartDate = getNextMonday();
    //const emailWindowStartDate = new Date("2025-08-04T17:02:00"); //TODO: this is a debug line, remove it
    const emailWindowEndDate = getNextMonday(emailWindowStartDate);
    const startDateString = emailWindowStartDate.getFullYear() + "-" + (emailWindowStartDate.getMonth() + 1) + "-" + emailWindowStartDate.getDate()
    const endDateString = emailWindowEndDate.getFullYear() + "-" + (emailWindowEndDate.getMonth() + 1) + "-" + emailWindowEndDate.getDate()

    const eventsPath = "https://api.wildapricot.org/" + waApiVersion + "/accounts/" + waAccountNumber + "/Events?"; //API endpoint
    const eventsFilter = "$filter=StartDate lt " + endDateString + " And EndDate gt " + startDateString + "&$sort=StartDate asc"; //filter
    const eventsSort = "&$sort=StartDate asc"; //sort order
    const eventsUrl = eventsPath + eventsFilter + eventsSort;

    console.log("\tURL:" + eventsUrl);

    const eventsConfig = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + waToken
      }
    };
    const eventsRes = await axios.get(eventsUrl, eventsConfig);

    console.log("====== RAW RESULT ====");
    console.log(eventsRes);

    const eventsRaw = eventsRes.data.Events;

    console.log("====== RAW EVENTS ====");
    console.log(eventsRaw);

    var eventsFiltered = [];

    for (const event of eventsRaw) {
      const ADMIN_ONLY = "AdminOnly".toUpperCase(); //they want RESTRICTED (member only) and PUBLIC events to show but not ADMIN (hidden) events.
      if (ADMIN_ONLY != event.AccessLevel.toUpperCase()) { //prevents admin events from being added to the list

        //Get the Event description 
        const eventDetailsPath = "https://api.wildapricot.org/" + waApiVersion + "/accounts/" + waAccountNumber + "/Events/" + event.Id;
        console.log("Getting Event Details: " + eventDetailsPath);
        const eventDetailsRes = await axios.get(eventDetailsPath, eventsConfig);
        const eventDescription = eventDetailsRes.data.Details.DescriptionHtml ? eventDetailsRes.data.Details.DescriptionHtml : "";


        if (null == event.Sessions) { //if there are no sessions
          //build an event object with the fields we care about
          const newEvent = {};
          newEvent.Name = event.Name;
          newEvent.DateTime = event.StartDate;
          newEvent.Id = event.Id;
          newEvent.Location = event.Location;
          newEvent.DescriptionHtml = eventDescription;
          newEvent.Tags = event.Tags ? event.Tags : [];
          eventsFiltered.push(newEvent); //add the event
        } else { //use the individual sessions
          event.Sessions.forEach(function (session) {

            //filter only sessions for this week
            const sessionStartDate = new Date(session.StartDate);
            const sessionEndDate = new Date(session.EndDate);
            if (sessionStartDate < emailWindowEndDate && sessionEndDate > emailWindowStartDate) {
              //build an event object with the fields we care about, for each session
              const newEvent = {};
              newEvent.Name = session.Title;
              newEvent.DateTime = session.StartDate;
              newEvent.Id = event.Id;
              newEvent.Location = event.Location;
              newEvent.DescriptionHtml = eventDescription;
              newEvent.Tags = event.Tags ? event.Tags : [];
              eventsFiltered.push(newEvent); //add each session
            }
          });
        }
      }
    }

    console.log("====== FILTERED EVENTS ====");
    console.log(eventsFiltered);

    console.log("\tOK.");
    return eventsFiltered;
  } catch (err) {
    throw new Error('Unable to get events: ' + err);
  }
}


function buildEmailBody(events) {
  console.log("Build email body...");
  //sort the events into DayOfWeek Buckets
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const eventsByDay = {
    "Monday": [],
    "Tuesday": [],
    "Wednesday": [],
    "Thursday": [],
    "Friday": [],
    "Saturday": [],
    "Sunday": []
  };

  console.log("====== THE EVENTS ====");
  console.log(events);

  events.forEach(function (event) {

    console.log("====== THIS EVENT ====");
    console.log(event);

    const eventDayNumber = (new Date(event.DateTime)).getDay();
    const eventDayName = daysOfWeek[eventDayNumber];
    eventsByDay[eventDayName].push(event); //add the event to the correct day
  });


  var emailBody = "";
  emailBody += "<style>html{font-family:sans-serif;}</style>\n";
  emailBody += "<p>";
  emailBody += "Ahoy, {Contact_First_Name}!";
  emailBody += "</p>";
  emailBody += "<p>";
  emailBody += "Get ready for another exciting week of sailing events at the Clinton Lake Sailing Association (CLSA)! <br><br>Here's a quick overview of the upcoming events:";
  emailBody += "</p>";
  emailBody += "";

  Object.keys(eventsByDay).forEach(day => {
    if (eventsByDay[day].length > 0) {
      var TmstmpOfFirstEvent = new Date(eventsByDay[day][0].DateTime);
      var dateMonth = TmstmpOfFirstEvent.getMonth() + 1;
      var dateDay = TmstmpOfFirstEvent.getDate();

      emailBody += "<h3 style='text-decoration: underline'>" + day + " (" + dateMonth + "/" + dateDay + ")" + "</h3>";
      eventsByDay[day].forEach(function (event) {
        emailBody += "<p style='margin-left: 2em'>";
        //emailBody += "&bull; <a href='https://www.clsasailing.org/event-" + event.Id + "'><strong>" + event.Name + "</strong></a>";
        emailBody += "&bull; <strong>" + event.Name + "</strong>";
        emailBody += ", " + new Date(event.DateTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        emailBody += " @ " + event.Location;
        if (event.Tags.includes("volunteer opportunity")) {
          emailBody += " &mdash; <em style='color:red;'>*Volunteers Needed!*</em>";
        }
        emailBody += " | <a href='https://www.clsasailing.org/event-" + event.Id + "'>Details</a>";
        emailBody += "</p>";
      });
    }
  });

  emailBody += "";
  emailBody += "<p>To view all upcoming events, please refer to the <a href='https://www.clsasailing.org/calendar'><strong>CLSA Events Calendar</strong></a>.</p>"
  emailBody += "<p>Fair winds and smooth sailing!</p>";
  emailBody += "<hr />";
  emailBody += "<small>To stop receiving the Weekly Email Blast visit <a href='{Member_Profile_URL}'>your member profile</a>, choose 'Edit' at the top, and then remove yourself from the 'WeeklyEmailBlast' group. To stop all CLSA emails: <a href='{Unsubscribe_Url}'>unsubscribe</a>.</small>";

  //TODO: Debug line, remove later
  // fs.writeFile('./testEmail.html', emailBody, err => {
  //   if (err) {
  //     console.error(err);
  //   } else {
  //     // file written successfully
  //   }
  // });

  console.log("\tOK.");
  return emailBody;
}

function getNextMonday(date = new Date()) {
  const dateCopy = new Date(date.getTime());
  const nextMonday = new Date(
    dateCopy.setDate(
      dateCopy.getDate() + ((7 - dateCopy.getDay() + 1) % 7 || 7),
    ),
  );
  console.log("Next Monday:" + nextMonday);
  return nextMonday;
}

async function sendEmailBlast() {

  console.log("Reading in configuration file...");
  const config = require('./squidwardSettings.json');
  const environment = config.environment.toUpperCase();
  const waApiVersion = config.wildApricotAPI.version;
  const waSecret = config.wildApricotAPI.secret;
  const waAccountNumber = config.wildApricotAPI.accountNumber;
  const waEmailGroupNumber = config.wildApricotAPI.weeklyEmailBlastGroupId;
  console.log("\tOK.");


  console.log("Process email blast...");
  const waToken = await getToken(waSecret);
  const members = await getMembers(waToken, waApiVersion, waAccountNumber, waEmailGroupNumber);
  const events = await getThisWeeksEvents(waToken, waApiVersion, waAccountNumber);

  if (events.length == 0) {//if there are no events this week, don't send an email
    console.log('No email to send, there are no events this week.');
  } else {
    const emailData = {
      "Subject": "CLSA - Events this week!",
      "Body": buildEmailBody(events),
      "ReplyToAddress": "clintonlakesailing@gmail.com",
      "ReplyToName": "CLSA",
      "Recipients": buildRecipientsList(members)
    }
    const emailUrl = "https://api.wildapricot.org/" + waApiVersion + "/rpc/" + waAccountNumber + "/email/SendEmail";
    const emailConfig = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + waToken
      }
    };

    try {
      if ('PROD' == environment) {
        const emailIdNumber = await axios.post(emailUrl, emailData, emailConfig)
        console.log("Email sent to " + members.length + " recipients. To track processing details see: https://www.clsasailing.org/admin/emails/log/details/?emailId=" + emailIdNumber.data + "&persistHeader=1");
      } else if ('DEV' == environment) {
        console.log("DEV ENVIRONMENT, not sending request to process email.");
      } else {
        throw new Error("Unknown environment configuration value: " + environment);
      }
    } catch (err) {
      throw new Error('Unable to send the email. ' + err);
      process.exit(1);
    }
  }
}

sendEmailBlast();
