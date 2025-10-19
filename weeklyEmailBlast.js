const axios = require('axios');
const fs = require('node:fs');

//Read in Configuration Params
console.log("Reading in configuration file...");
const CONFIG = require('./squidwardSettings.json');
const ENVIRONMENT = CONFIG.environment.toUpperCase();
const WA_API_VERSION = CONFIG.wildApricotAPI.version;
const WA_SECRET = CONFIG.wildApricotAPI.secret;
const WA_ACCOUNT_NUMBER = CONFIG.wildApricotAPI.accountNumber;
const WA_EMAIL_GROUP_ID = CONFIG.wildApricotAPI.weeklyEmailBlastGroupId;
const WA_MAX_RECORDS_PER_PAGE = CONFIG.wildApricotAPI.maxRecordsPerPage;
console.log("\tDone.");

async function getToken() {
  console.log("Get Wild Apricot Token...");
  const tokenUrl = "https://oauth.wildapricot.org/auth/token";
  const tokenConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + WA_SECRET,
      "Connection": "keep-alive"
    }
  };
  const tokenData = {
    "grant_type": "client_credentials",
    "scope": "auto"
  }
  try {
    const reqToken = await axios.post(tokenUrl, tokenData, tokenConfig)
    console.log("\tDone.");
    return reqToken.data.access_token;
  } catch (err) {
    throw new Error('Unable to aquire access token: ' + err);
  }
}

async function getMembers(waToken) {
  console.log("Get email recipients...");
  let usersUrl = "https://api.wildapricot.org/" + WA_API_VERSION + "/accounts/" + WA_ACCOUNT_NUMBER + "/Contacts"
  usersUrl += "?$async=false&$filter=Status eq Active AND 'Group participation.Label' eq '"+WA_EMAIL_GROUP_ID+"'"; //add the filters
  const usersConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + waToken
    }
  };

  try {
    
    let pageOffset = 0;
    let memberContacts = [];
    let resContacts;
    do{
      let recordsOffset = WA_MAX_RECORDS_PER_PAGE*pageOffset;
      let paginatedQuery = usersUrl+"&$top="+WA_MAX_RECORDS_PER_PAGE+"&$skip="+recordsOffset;
      
      console.log("\tURL:" + paginatedQuery);
      resContacts = await axios.get(paginatedQuery, usersConfig);
      memberContacts = memberContacts.concat(resContacts.data.Contacts);
      
      pageOffset++;
    }while(WA_MAX_RECORDS_PER_PAGE == resContacts.data.Contacts.length);

    //console.log("====== CONTACTS RESULT ====");
    //console.log(memberContacts);
    console.log("\tRetrieved " + memberContacts.length + " contacts");
    
    console.log("\tDone.");
    return memberContacts;
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
  console.log("\tDone.");
  return recipients;
}

async function getThisWeeksEvents(waToken) {
  try {
    console.log("Get events list...");
    const emailWindowStartDate = getNextMonday();
    //const emailWindowStartDate = new Date("2025-08-04T17:02:00"); //TODO: this is a debug line, remove it
    const emailWindowEndDate = getNextMonday(emailWindowStartDate);
    const startDateString = emailWindowStartDate.getFullYear() + "-" + (emailWindowStartDate.getMonth() + 1) + "-" + emailWindowStartDate.getDate()
    const endDateString = emailWindowEndDate.getFullYear() + "-" + (emailWindowEndDate.getMonth() + 1) + "-" + emailWindowEndDate.getDate()

    const eventsPath = "https://api.wildapricot.org/" + WA_API_VERSION + "/accounts/" + WA_ACCOUNT_NUMBER + "/Events?"; //API endpoint
    const eventsFilter = "$filter=StartDate lt " + endDateString + " And EndDate gt " + startDateString + "&$sort=StartDate asc"; //filter
    const eventsSort = "&$sort=StartDate asc"; //sort order
    const eventsPagination = "&$top="+WA_MAX_RECORDS_PER_PAGE+"&$skip=0"; //if we have more than 100 events (including re-occuring series) in a week I'll cry
    const eventsUrlWithPagination = eventsPath + eventsFilter + eventsSort + eventsPagination;

    console.log("\tURL:" + eventsUrlWithPagination);

    const eventsConfig = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + waToken
      }
    };

    const eventsRes = await axios.get(eventsUrlWithPagination, eventsConfig); //pagination is hard coded, see above
    const eventsRaw = eventsRes.data.Events;

    console.log("====== RAW EVENTS ====");
    console.log(eventsRaw);

    var eventsFiltered = [];

    for (const event of eventsRaw) {
      const ADMIN_ONLY = "AdminOnly".toUpperCase(); //they want RESTRICTED (member only) and PUBLIC events to show but not ADMIN (hidden) events.
      if (ADMIN_ONLY != event.AccessLevel.toUpperCase()) { //prevents admin events from being added to the list

        //Get the Event description 
        const eventDetailsPath = "https://api.wildapricot.org/" + WA_API_VERSION + "/accounts/" + WA_ACCOUNT_NUMBER + "/Events/" + event.Id;
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

    console.log("\tDone.");
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

  console.log("\tDone.");
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

  console.log("Process email blast...");
  const waToken = await getToken();
  const members = await getMembers(waToken);
  const events = await getThisWeeksEvents(waToken);

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
    const emailUrl = "https://api.wildapricot.org/" + WA_API_VERSION + "/rpc/" + WA_ACCOUNT_NUMBER + "/email/SendEmail";
    const emailConfig = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + waToken
      }
    };

    try {
      if ('PROD' == ENVIRONMENT) {
        const emailIdNumber = await axios.post(emailUrl, emailData, emailConfig)
        console.log("Email sent to " + members.length + " recipients. To track processing details see: https://www.clsasailing.org/admin/emails/log/details/?emailId=" + emailIdNumber.data + "&persistHeader=1");
      } else if ('DEV' == ENVIRONMENT) {
        console.log("DEV environment, not sending request to process email.");
      } else {
        throw new Error("Unknown environment configuration value: " + ENVIRONMENT);
      }
    } catch (err) {
      throw new Error('Unable to send the email. ' + err);
      process.exit(1);
    }
  }
}

sendEmailBlast();
