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
rem Razmer pechataetsya ryadom s putyom NAMERENNO: pervyy zapusk u vladel'ca dal
rem PUSTOY fayl (buferizaciya stderr, pochineno v main.cpp), i po otkryvshemusya
rem Bloknotu eto vyglyadelo kak "profil' ne rabotaet voobshe". Chislo bayt
rem otvechaet na etot vopros do togo, kak ego zadadut.
for %%F in ("%~dp0gigahrush2_prof.txt") do echo Profil: %%~zF bayt -^> %%~fF
echo Prishlite etot fayl.

rem ZAKRYVAT' NADO OKNO IGRY, a ne etu konsol': zakrytie konsoli ubivaet
rem docherniy process. S _IONBF dannye uzhe na diske, no posledniy otchyot
rem "na vyhode" pri takom ubiystve vsyo ravno ne napechataetsya.
start "" notepad "%~dp0gigahrush2_prof.txt"
