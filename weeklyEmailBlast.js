const axios = require('axios');

async function getToken(waSecret) {
  console.log("Get Wild Apricot Token...");
  const tokenUrl = "https://oauth.wildapricot.org/auth/token";
  const tokenConfig = {
    headers:{
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
  } catch(err) {
    throw new Error('Unable to aquire access token: ' + err);
  }
}

async function getMembers(waToken, waApiVersion, waAccountNumber, waEmailGroupNumber) {
  console.log("Get email recipients...");
  const usersUrl = "https://api.wildapricot.org/"+waApiVersion+"/accounts/"+waAccountNumber+"/Contacts?$async=false&$filter=Status eq Active";
  const usersConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + waToken
    }
  };

  const blastGroupUrl = "https://api.wildapricot.org/"+waApiVersion+"/accounts/"+waAccountNumber+"/membergroups/"+waEmailGroupNumber;
  const blastGroupConfig = {
    headers:{
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
    const filteredContacts = contacts.filter(function(contact) {
      return blastGroupMemberIds.includes(contact.Id);
    });
    
    console.log("\tOK.");
    return filteredContacts;
  } catch(err) {
    throw new Error('Error getting users: ' + err);
  }
}

function buildRecipientsList(members){
  console.log("Build recipients list...");
  const recipients = [];
  members.forEach(function(member) {
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
  console.log("Get events list...");
  const startDate = getNextMonday();
  const endDate = getNextMonday(startDate);
  const startDateString = startDate.getFullYear() + "-" + (startDate.getMonth()+1) + "-" + startDate.getDate()
  const endDateString = endDate.getFullYear() + "-" + (endDate.getMonth()+1) + "-" + endDate.getDate()

  const eventsUrl = "https://api.wildapricot.org/"+waApiVersion+"/accounts/"+waAccountNumber+"/Events?$filter=StartDate ge "+startDateString+" And StartDate lt "+endDateString+"";
  const eventsConfig = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + waToken
    }
  };

  try {
    const eventsRes = await axios.get(eventsUrl, eventsConfig);
    const events = eventsRes.data.Events;

    //events were not in ASC(StartDate) order, I think maybe by DESC(ID)?
    //anyway we need to reorder them to ensure consistency.
    events.sort((a, b) => {
      const date1 = new Date(a.StartDate);
      const date2 = new Date(b.StartDate);

      if (date1 > date2) {
        return 1;
      }
      if (date1 < date2) {
        return -1;
      }
      return 0;
    });
    console.log("\tOK.");
    return events;
  } catch(err) {
    throw new Error('Unable to get events: ' + err);
  }
}

function buildEmailBody(events){
  console.log("Build email body...");
  //sort the events into DayOfWeek Buckets
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const eventsByDay = {
    "Monday": [],
    "Tuesday": [],
    "Wednesday": [],
    "Thursday": [],
    "Friday": [],
    "Saturday": [],
    "Sunday": []
  };

  events.forEach(function(event){
    const eventDayNumber = (new Date(event.StartDate)).getDay();
    const eventDayName = daysOfWeek[eventDayNumber];
    if("PUBLIC" == event.AccessLevel.toUpperCase()){ //prevents admin/special events from being added to the list
      eventsByDay[eventDayName].push(event);
    }
  });

  var emailBody = "<p>"
  emailBody += "Ahoy, {Contact_First_Name}!";
  emailBody += "</p>";
  emailBody += "<p>";
  emailBody += "Get ready for another exciting week of sailing events at the Clinton Lake Sailing Association (CLSA)! Here's a quick overview of the upcoming events:";
  emailBody += "</p>";
  emailBody += "<dl>";

  Object.keys(eventsByDay).forEach(day => {
    if(eventsByDay[day].length>0){
      emailBody += "<dt style='font-weight:bold'>"+day+"</dt>";
      eventsByDay[day].forEach(function(event){
        emailBody += "<dd>- " + event.Name + ", ";
        emailBody += (new Date(event.StartDate)).toLocaleString() + " ";
        emailBody += "<a href='https://www.clsasailing.org/event-" + event.Id+ "'>(Details)</a></dd>";
      });
    }
  });

  emailBody += "</dl>";
  emailBody += "<p>To view all upcoming events, please refer to the <a href='https://www.clsasailing.org/calendar'><strong>CLSA Events Calendar</strong></a>.</p>"
  emailBody += "<p>Fair winds and smooth sailing!</p>";
  emailBody += "<hr />";
  emailBody += "<small>To stop receiving the Weekly Email Blast visit <a href='{Member_Profile_URL}'>your member profile</a>, choose 'Edit' at the top, and then remove yourself from the 'WeeklyEmailBlast' group. To stop all CLSA emails: <a href='{Unsubscribe_Url}'>unsubscribe</a>.</small>";

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
  const events = await getThisWeeksEvents(waToken, waApiVersion, waAccountNumber, waEmailGroupNumber);

  if(events.length == 0){//if there are no events this week, don't send an email
    console.log('No email to send, there are no events this week.');
  } else {
    const emailData = {
      "Subject": "CLSA - Events this week!",
      "Body": buildEmailBody(events),
      "ReplyToAddress": "clintonlakesailing@gmail.com",
      "ReplyToName": "CLSA",
      "Recipients": buildRecipientsList(members)
      }
    const emailUrl = "https://api.wildapricot.org/"+waApiVersion+"/rpc/"+waAccountNumber+"/email/SendEmail";
    const emailConfig = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Bearer " + waToken
      }
    };

    try {
      if('PROD' == environment ){
        const emailIdNumber = await axios.post(emailUrl, emailData, emailConfig)
        console.log("Email sent to "+members.length+" recipients. To track processing details see: https://www.clsasailing.org/admin/emails/log/details/?emailId="+emailIdNumber.data+"&persistHeader=1");
      }else if('DEV' == environment ){
        console.log("DEV ENVIRONMENT, not sending request to process email.");
      }else{
        throw new Error("Unknown environment configuration value: " + environment);
      }      
    } catch(err) {
      throw new Error('Unable to send the email. ' + err);
      process.exit(1);
    }
  }
}

sendEmailBlast();
