const axios = require('axios');

const apiVersion = "v2.2";

//console.log("Starting Email processing...");

async function getToken() {
  //console.log("Get acess token...");

  const tokenUrl = "https://oauth.wildapricot.org/auth/token";
  const tokenConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + process.env.SQUIDWARD_SECRET,
      "Connection": "keep-alive"
    }
  };
  const tokenData ={
    "grant_type": "client_credentials",
    "scope": "auto"
  }
  try {
    const reqToken = await axios.post(tokenUrl, tokenData, tokenConfig)
    //console.log("... OK.");
    return reqToken.data.access_token;
  } catch(err) {
    throw new Error('Unable to aquire access token: ' + err);
  }
}

async function getMembers(token) {
  console.log("Get Active CLSA Members in WeeklyEmailBlast list...");
  const usersUrl = "https://api.wildapricot.org/"+apiVersion+"/accounts/"+process.env.SQUIDWARD_CLSAACCNTNUM+"/Contacts?$async=false&$filter=Status eq Active";
  const usersConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + token
    }
  };

  const weeklyEmailBlastGroupId = 754676;
  const blastGroupUrl = "https://api.wildapricot.org/"+apiVersion+"/accounts/"+process.env.SQUIDWARD_CLSAACCNTNUM+"/membergroups/"+weeklyEmailBlastGroupId;
  const blastGroupConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + token
    }
  };


  try{
    const resContacts = await axios.get(usersUrl, usersConfig);
    const resWeeklyEmailBlastMembers = await axios.get(blastGroupUrl, blastGroupConfig);

    //filter, selecting only members who are in the WeeklyEmailBlast group
    var contacts = resContacts.data.Contacts;
    var blastGroupMemberIds = resWeeklyEmailBlastMembers.data.ContactIds;
    var filteredContacts = contacts.filter(function(contact) {
        return blastGroupMemberIds.includes(contact.Id);
    });

    //console.log(filteredContacts);
    console.log("... found "+filteredContacts.length+" of "+contacts.length+" members.");

    return filteredContacts;
  } catch(err) {
    throw new Error('Error getting users: ' + err);
  }
}

function buildRecipientsList(members){
  const recipients = [];

  members.forEach(function(member){
  recipients.push({
      "Id": member.Id,
      "Type": "IndividualContactRecipient", //This is just a static value
      "Name": member.FistName + " " + member.LastName,
      "Email": member.Email
    });
  });
  return recipients;
}

async function getThisWeeksEvents(token) {
  startOfThisWeekDate=getNextMonday();
  startOfNextWeekDate=getNextMonday(startOfThisWeekDate);
  var nextMonday = startOfThisWeekDate.getFullYear() + "-" + (startOfThisWeekDate.getMonth()+1) + "-" + startOfThisWeekDate.getDate()
  var nextNextMonday = startOfNextWeekDate.getFullYear() + "-" + (startOfNextWeekDate.getMonth()+1) + "-" + startOfNextWeekDate.getDate()

  const eventsUrl = "https://api.wildapricot.org/"+apiVersion+"/accounts/"+process.env.SQUIDWARD_CLSAACCNTNUM+"/Events?$filter=StartDate ge "+nextMonday+" And StartDate lt "+nextNextMonday+"";
  const eventsConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + token
    }
  };

  try{
    const eventsRes = await axios.get(eventsUrl, eventsConfig);

    var events = eventsRes.data.Events;

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

    return events;
  } catch(err) {
    throw new Error('Unable to get events: ' + err);
  }
}

function buildEmailBody(events){

  //sort the events into DayOfWeek Buckets
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var eventsByDay = {
    "Monday": [],
    "Tuesday": [],
    "Wednesday": [],
    "Thursday": [],
    "Friday": [],
    "Saturday": [],
    "Sunday": []
  };

  events.forEach(function(event){
    var eventDayNumber = (new Date(event.StartDate)).getDay();
    var eventDayName = daysOfWeek[eventDayNumber];
    eventsByDay[eventDayName].push(event);
  });

  //console.log(eventsByDay);

  var emailBody = "<p>"
  emailBody += "Ahoy, {Contact_First_Name}!";
  emailBody += "</p>";
  emailBody += "<p>";
  emailBody += "Get ready for another exciting week of sailing events at the Clinton Lake Sailing Association (CLSA)! Here's a quick overview of the upcoming events:";
  emailBody += "</p>";
  emailBody += "<dl>";

  Object.keys(eventsByDay).forEach(day => {
    emailBody += "<dt style='font-weight:bold'>"+day+"</dt>";
    if(eventsByDay[day].length>0){
      eventsByDay[day].forEach(function(event){
        emailBody += "<dd>- " + event.Name + ", ";
        emailBody += (new Date(event.StartDate)).toLocaleString() + " ";
        emailBody += "<a href='https://www.clsasailing.org/event-" + event.Id+ "'>(Details)</a></dd>";
      });
    }else{
      emailBody += "<dd>- No events today</dd>";
    }
  });

  emailBody += "</dl>";
  emailBody += "<p>Fair winds and smooth sailing!</p>";
  emailBody += "<hr />";
  emailBody += "<small>To stop receiving the Weekly Email Blast visit <a href='{Member_Profile_URL}'>your member profile</a>, choose 'Edit' at the top, and then remove yourself from the 'WeeklyEmailBlast' group. To stop all CLSA emails: <a href='{Unsubscribe_Url}'>unsubscribe</a>.</small>";

  //console.log(emailBody);

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

async function main() {
  const token = await getToken();
  const members = await getMembers(token);
  const events = await getThisWeeksEvents(token);

  const requestBody = {
    "Subject": "CLSA - Events this week!",
    "Body": buildEmailBody(events),
    "ReplyToAddress": "clintonlakesailing@gmail.com",
    "ReplyToName": "CLSA",
    "Recipients": [
      {
        "Id": 111111,
        "Type": "IndividualContactRecipient",
        "Name": "first last",
        "Email": "name@email.com"
      }
    ]
    //"Recipients": buildRecipientsList(members)
    }

  const emailUrl = "https://api.wildapricot.org/"+apiVersion+"/rpc/"+process.env.SQUIDWARD_CLSAACCNTNUM+"/email/SendEmail";
  const emailConfig = {
    headers:{
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Bearer " + token
    }
  };
  const emailData = requestBody;
  try {
    const emailIdNumber = await axios.post(emailUrl, emailData, emailConfig)
    console.log("Email sent to "+1+" recipients. To track processing details see: https://www.clsasailing.org/admin/emails/log/details/?emailId="+emailIdNumber.data+"&persistHeader=1");
  } catch(err) {
    console.log('Unable to send the email.', err)
  }

}

main();
