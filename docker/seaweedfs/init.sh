#!/bin/sh
# Creates the local store's buckets and applies the media bucket's CORS rule (D-143, D-253).
set -eu

tries=0
until aws --endpoint-url "$S3_ENDPOINT" s3api list-buckets >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "object store at $S3_ENDPOINT did not answer after $tries tries" >&2
    exit 1
  fi
  sleep 2
done

for bucket in media data dev-data backups legal; do
  if output=$(aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$bucket" 2>&1); then
    echo "created bucket $bucket"
  else
    case "$output" in
      *BucketAlreadyOwnedByYou* | *BucketAlreadyExists*)
        echo "bucket $bucket already exists"
        ;;
      *)
        echo "$output" >&2
        exit 1
        ;;
    esac
  fi
done

aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-cors --bucket media --cors-configuration file:///init/cors.json
echo "applied the CORS rule to media"
exit 0
