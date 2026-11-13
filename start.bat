@echo off
title JobBot - Fullstack Runner (Front + Back)
if exist "C:\Program Files\nodejs" set "PATH=%PATH%;C:\Program Files\nodejs"
cd /d "%~dp0"
node dev.js
