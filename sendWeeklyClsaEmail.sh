#!/bin/bash

retry_limit=5
retry_count=0

echo "Sending CLSA Weekly Email..."

while [[ $retry_count -lt $retry_limit ]]
do
  node ./weeklyEmailBlast.js
  
  exit_code=$?
  
  if [[ $exit_code -eq 0 ]]
  then
    echo "SUCCESS: Email script executed successfully."
    break
  else
    echo "WARN: Email script exited with non-zero exit code. Retrying..."
    ((retry_count++))
    sleep_count=$((retry_count * 60))  # Calculate the sleep time, Adding an increasing delay based on retry count
    echo "\tWaiting for $sleep_count seconds..."
    sleep "$sleep_count"
  fi
done

if [[ $retry_count -eq $retry_limit ]]
then
  echo "ERROR: Exceeded retry limit. Node script execution failed."
  exit 1
fi
