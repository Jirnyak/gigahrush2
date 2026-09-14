@echo off
rem ---------------------------------------------------------------------------
rem gigahrush2 - snyatie profilya (Windows).
rem
rem ASCII ONLY, NAMERENNO. Etot .bat ispolnyaet cmd.exe, u kotorogo kodovaya
rem stranica konsoli zavisit ot lokali mashiny (866, 1251, 65001 - kak povezyot).
rem Kirillica v echo prevrashaetsya v musor imenno na chuzhoy mashine, to est'
rem tam, gde etot fayl i nuzhen. Russkiy tekst zhivyot v README-profile.txt,
rem kotoryy chitaet Notepad, a ne cmd.
rem ---------------------------------------------------------------------------

rem cd v papku s exe: pri zapuske iz Provodnika rabochiy katalog byvaet chuzhim,
rem a igra ishet data\ i shaders\ otnositel'no nego.
cd /d "%~dp0"

echo Zapusk gigahrush2 s profilirovaniem...
echo Igrayte 1-2 minuty, potom zakroyte okno igry.
echo.

gigahrush2.exe --prof gigahrush2_prof.txt

echo.
echo Profil zapisan: %~dp0gigahrush2_prof.txt
echo Prishlite etot fayl.
start "" notepad "%~dp0gigahrush2_prof.txt"
