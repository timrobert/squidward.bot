#!/bin/bash

retry_limit=7
retry_count=0

printf "Sending CLSA Weekly Email..."

while [ $retry_count -lt $retry_limit ]
do
  cd ~/Documents/CLSA/squidward.bot/
  pwd
  ls -lsa
  node weeklyEmailBlast.js

  exit_code=$?

  if [ $exit_code -eq 0 ]
  then
    printf "SUCCESS: Email script executed successfully."
    break
  else
    printf "WARN: Email script exited with non-zero exit code. Retrying..."
    retry_count=$((retry_count + 1))
    sleep_count=$((30 * 60))  #delay in 1/2 hr increments, 30minutes * 60seconds
    #sleep_count=$((retry_count * 60 * 60))  # Calculate the sleep time, delay in 1hr increments
    printf "\tWaiting for %s minutes..." $((sleep_count/60))
    sleep "$sleep_count"
  fi
done

if [ $retry_count -ge $retry_limit ]
then
  printf "ERROR: Exceeded retry limit. Node script execution failed."
  exit 1
fi