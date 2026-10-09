#!/usr/bin/env bash
# ساخت APK بدون Gradle: فقط ابزارهای خود Android SDK (aapt2, d8, zipalign, apksigner)
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLAT="$(ls "$SDK/platforms" | grep -E '^android-[0-9]+$' | sort -V | tail -1)"
JAR="$SDK/platforms/$PLAT/android.jar"
VCODE="${VERSION_CODE:-1}"; VNAME="1.$VCODE"
echo "build-tools: $BT  platform: $PLAT  version: $VNAME"
rm -rf build && mkdir -p build/gen build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VCODE" --version-name "$VNAME" \
  --java build/gen build/res.zip
javac -source 8 -target 8 -bootclasspath "$JAR" -encoding UTF-8 -nowarn -d build/classes \
  $(find src build/gen -name '*.java')
"$BT/d8" --release --lib "$JAR" --min-api 24 --output build/dex $(find build/classes -name '*.class')
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -p -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks release.jks --ks-pass pass:homeapp-sign --key-pass pass:homeapp-sign --ks-key-alias home \
  --out build/home.apk build/aligned.apk
"$BT/apksigner" verify build/home.apk
ls -la build/home.apk
