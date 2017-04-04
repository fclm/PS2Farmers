/**
 * Created by Dylan on 03-Apr-16.
 */
const api_key   = require('./api_key.js'),
    teams     = require('./teams.js'),
    items     = require('./items.js'),
    WebSocket = require('ws'),
    app       = require('./app'),
    fs        = require('fs'),
    io        = require('socket.io');

let  teamOne,
    teamOneObject,
    teamTwoObject,
    teamTwo,
    captures = 0,
    roundTracker = 0,
    time = Date.now(),
    pOne = '',
    pTwo = '',
    pThree = '',
    timeCounter = 0;

let memberTemplate = JSON.stringify({
    name : '',
    points : 0,
    netScore : 0,
    kills : 0,
    deaths : 0
});

const pointNumbers = ['0','1','11','12','13','21','22','23'];

// Point Map default to thunderdome ruleset
let pointMap = {
    '0'  : { "action" : "First Base Capture",      points : 10, id : "class0"},
    '1'  : { "action" : "Subsequent Base Capture", points : 25, id : "class1"},
    '11' : { "action" : "Max v Infantry Kill",     points : 1,  id : "class11"},
    '12' : { "action" : "Max v Max Kill",          points : 3,  id : "class12"},
    '13' : { "action" : "Max Suicide",             points : -5, id : "class13"},
    '21' : { "action" : "Infantry TK",             points : -5, id : "class21"},
    '22' : { "action" : "Infantry Suicide",        points : -2, id : "class22"},
    '23' : { "action" : "Infantry v Max",          points : 5,  id : "class23"},
    'name': 'Thunderdome Ruleset'
};

// Thunderdome (2016)
const thunderdomePointMap = {'0':10, '1':25, '11':1, '12':3, '13':-5, '21':-5, '22':-2, '23':5 };

// Emerald "Durdledome" (2016)
const emeraldPointMap = { '0':10, '1':25, '11':0, '12':3, '13':-4, '21':-3, '22':-3, '23':4 };

// Briggs OvO (2017)
const ovoPointMap = { '0':12, '1':24, '11':0, '12':2, '13':-12, '21':-3, '22':-3, '23':12 };

function getPointMaps() {
    return pointMap;
}

function updatePointMap(number) {
    pointNumbers.forEach(function (data) {
        if (number === 0) { pointMap[data].points = thunderdomePointMap[data]; }
        else if (number === 1) { pointMap[data].points = emeraldPointMap[data]; }
        else if (number === 2) { pointMap[data].points = ovoPointMap[data]; }
    });
    if (number === 0) { pointMap['name'] = 'Thunderdome'; }
    if (number === 1) { pointMap['name'] = 'Emerald'; }
    if (number === 2) { pointMap['name'] = 'Briggs OvO'; }
}

function individualPointUpdate(event) {
    if (event.class0  !== '') { pointMap['0'].points = event.class0; }
    if (event.class1  !== '') { pointMap['1'].points = event.class1; }
    if (event.class11 !== '') { pointMap['11'].points = event.class11; }
    if (event.class12 !== '') { pointMap['12'].points = event.class12; }
    if (event.class13 !== '') { pointMap['13'].points = event.class13; }
    if (event.class21 !== '') { pointMap['21'].points = event.class21; }
    if (event.class22 !== '') { pointMap['22'].points = event.class22; }
    if (event.class23 !== '') { pointMap['23'].points = event.class23; }
    pointMap.name = 'Custom';
}

/*
 Overlay Code
 Writes to 5 files to allow a streamer to use them in OBS to display the match stats
 */

function scoreUpdate() {
    //for use in OBS for the overlay
    //writes to multiple text files the current team score
    fs.writeFile('overlay/scoreT1.txt', teamOneObject.points, function (err) {
        if (err) {
            return console.log('scoreT1.txt Error: ' + err);
        }
    });

    fs.writeFile('overlay/scoreT2.txt', teamTwoObject.points, function (err) {
        if (err) {
            return console.log('scoreT2.txt Error: ' + err);
        }
    });
    //Writes player data to a text file
    let teamOneActivePlayers = [];
    for (keys in teamOneObject.members) {
        teamOneActivePlayers.push(teamOneObject.members[keys])
    }
    let teamOneActive = '';
    let i = 0;
    teamOneActivePlayers.forEach(function (member) {
        if ((member.points > 0) || (member.netScore !== 0)) {
            let memName = lengthenName(member.name);
            let netScore = lengthenStats(member.netScore.toString());
            teamOneActive += memName + '  ' + netScore;
            if (i % 2 === 0) {
                teamOneActive += ' | ';
                i++
            } else {
                teamOneActive += '\n';
                i++;
            }
        }
    });
    fs.writeFile('overlay/playersT1.txt', teamOneActive, function (err) {
        if (err) {
            return console.log('playersT1.txt Error: ' + err);
        }
    });
    let teamTwoActivePlayers = [];
    for (keys in teamTwoObject.members) {
        teamTwoActivePlayers.push(teamTwoObject.members[keys])
    }
    let teamTwoActive = '';
    i = 0;
    teamTwoActivePlayers.forEach(function (member) {
        if ((member.points > 0) || (member.netScore !== 0)) {
            let memName = lengthenName(member.name);
            let netScore = lengthenStats(member.netScore.toString());
            teamTwoActive += memName + '  ' + netScore;
            if (i % 2 === 0) {
                teamTwoActive += ' | ';
                i++
            } else {
                teamTwoActive += '\n';
                i++;
            }
        }
    });
    fs.writeFile('overlay/playersT2.txt', teamTwoActive, function (err) {
        if (err) {
            return console.log('playersT2.txt Error: ' + err);
        }
    });
}

function killfeedUpdate(killObj) {
    pThree = pTwo;
    pTwo = pOne;
    let killer = lengthenName(killObj.winner);
    let weapon = lengthenName('[' + killObj.weapon + ']');
    let  killed = lengthenName(killObj.loser);
    pOne = killer + ' ' + weapon + '  ' + killed + '\n';
    let feed = pOne + pTwo + pThree;
    fs.writeFile('overlay/killfeed.txt', feed, function(err) {
        if (err) {
            return console.log('killfeed.txt Error: ' + err);
        }
    })
}

function killfeedBaseUpdate(tag, points) {
    pThree = pTwo;
    pTwo = pOne;
    pOne = '       [' + tag + '] Captured the base (+' + points + ')\n';
    let feed = pOne + pTwo + pThree;
    fs.writeFile('overlay/killfeed.txt', feed, function(err) {
        if (err) {
            return console.log('killfeed.txt Error: ' + err);
        }
    })
}

function teamObject(team) {
    // Create a new indexable team object
    let outfit_obj = {
        alias : team.alias,
        outfit_id : team.outfit_id,
        name : team.name,
        faction : team.faction,
        points : 0,
        netScore : 0,
        kills : 0,
        deaths : 0,
        members : {}
    };
    team.members.forEach(function(member) {
        let obj = JSON.parse(memberTemplate);
        obj.name = member.name;
        if (!outfit_obj.hasOwnProperty(member.character_id)) {
            outfit_obj.members[member.character_id] = obj;
        }
    });
    return outfit_obj;
}

function sendScore() {
    if(roundTracker !== 0) {
        if (teamOneObject.name !== undefined) {
            app.sendScores(teamOneObject, teamTwoObject);
        }
    }
}

function dealWithTheData(raw) {
    raw = raw.replace(': :', ':');
    const data = JSON.parse(raw).payload;
    if (data.event_name === "Death") {
        itsPlayerData(data);
    } else if (data.name === "Death") {
        //debugging match only
        itsPlayerData(data);
    } else {
        itsFacilityData(data);
    }
}

function itsPlayerData(data) {
    //deals with adding points to the correct player & team
    const item = items.lookupItem(data.attacker_weapon_id);
    let points = items.lookupPointsfromCategory(item.category_id);
    if ((data.attacker_loadout_id === 7) || (data.attacker_loadout_id === 14) || (data.attacker_loadout_id === 21)) {
        //Attacker using a max
        if ((data.character_loadout_id === 7) || (data.character_loadout_id === 14) || (data.character_loadout_id === 21)) {
            //Attacker used a max to kill a max
            points = pointMap['12'].points;
        } else {
            //max v infantry
            points = pointMap['11'].points;
        }
    } else if ((data.character_loadout_id === 7) || (data.character_loadout_id === 14) || (data.character_loadout_id === 21)) {
        //defender used a max
        points = pointMap['23'].points;
    }
    if ((teamOneObject.members.hasOwnProperty(data.attacker_character_id)) && (teamTwoObject.members.hasOwnProperty(data.character_id))) {
        oneIvITwo(data, points, item);
    } else if ((teamTwoObject.members.hasOwnProperty(data.attacker_character_id)) && (teamOneObject.members.hasOwnProperty(data.character_id))) {
        twoIvIOne(data, points, item);
    } else if ((data.attacker_character_id === data.character_id) && (teamOneObject.members.hasOwnProperty(data.character_id))){
        if ((data.character_loadout_id === 7) || (data.character_loadout_id === 14) || (data.character_loadout_id === 21)) {
            //suicided as a max lol
            points = pointMap['13'].points;
        } else {
            //just infantry suicide
            points = pointMap['22'].points;
        }
        teamOneSuicide(data, points, item);
    } else if ((data.attacker_character_id === data.character_id) && (teamTwoObject.members.hasOwnProperty(data.character_id))){
        if ((data.character_loadout_id === 7) || (data.character_loadout_id === 14) || (data.character_loadout_id === 21)) {
            //suicided as a max lol
            points = pointMap['13'].points;
        } else {
            //just infantry suicide
            points = pointMap['22'].points;
        }
        teamTwoSuicide(data, points, item);
    } else if ((teamOneObject.members.hasOwnProperty(data.attacker_character_id)) && (teamOneObject.members.hasOwnProperty(data.character_id))) {
        // Hahahaha he killed his mate
        teamOneTeamkill(data, item);
    } else if ((teamTwoObject.members.hasOwnProperty(data.attacker_character_id)) && (teamTwoObject.members.hasOwnProperty(data.character_id))) {
        // Hahahaha he killed his mate
        teamTwoTeamkill(data, item);
    }
    app.sendScores(teamOneObject, teamTwoObject);
    scoreUpdate();
}

function oneIvITwo (data, points, item) {
    teamOneObject.points += points;
    teamOneObject.netScore += points;
    teamTwoObject.netScore -= points;
    teamOneObject.kills++;
    teamTwoObject.deaths++;
    teamOneObject.members[data.attacker_character_id].points += points;
    teamOneObject.members[data.attacker_character_id].netScore += points;
    teamTwoObject.members[data.character_id].netScore -= points;
    teamOneObject.members[data.attacker_character_id].kills++;
    teamTwoObject.members[data.character_id].deaths++;
    //logging
    console.log(teamOneObject.members[data.attacker_character_id].name + ' -->  ' + teamTwoObject.members[data.character_id].name + ' for ' + points + ' points (' + item.name + ')');
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamOneObject.members[data.attacker_character_id].name,
        winner_faction: teamOneObject.faction,
        loser: teamTwoObject.members[data.character_id].name,
        loser_faction: teamTwoObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function twoIvIOne (data, points, item) {
    teamTwoObject.points += points;
    teamTwoObject.netScore += points;
    teamOneObject.netScore -= points;
    teamTwoObject.kills++;
    teamOneObject.deaths++;
    teamTwoObject.members[data.attacker_character_id].points += points;
    teamTwoObject.members[data.attacker_character_id].netScore += points;
    teamOneObject.members[data.character_id].netScore -= points;
    teamTwoObject.members[data.attacker_character_id].kills++;
    teamOneObject.members[data.character_id].deaths++;
    //logging
    console.log(teamTwoObject.members[data.attacker_character_id].name + ' --> ' + teamOneObject.members[data.character_id].name + ' for ' + points + ' points (' + item.name + ')');
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamTwoObject.members[data.attacker_character_id].name,
        winner_faction: teamTwoObject.faction,
        loser: teamOneObject.members[data.character_id].name,
        loser_faction: teamOneObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function teamOneSuicide (data, points, item) {
    teamOneObject.points += points;
    teamOneObject.netScore += points;
    teamOneObject.deaths++;
    teamOneObject.members[data.attacker_character_id].points += points;
    teamOneObject.members[data.attacker_character_id].netScore += points;
    teamOneObject.members[data.attacker_character_id].deaths++;
    //logging
    console.log(teamOneObject.members[data.attacker_character_id].name + ' Killed himself -' + points);
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamOneObject.members[data.attacker_character_id].name,
        winner_faction: teamOneObject.faction,
        loser: teamOneObject.members[data.character_id].name,
        loser_faction: teamOneObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function teamTwoSuicide (data, points, item) {
    teamTwoObject.points += points;
    teamTwoObject.netScore += points;
    teamTwoObject.deaths++;
    teamTwoObject.members[data.attacker_character_id].points += points;
    teamTwoObject.members[data.attacker_character_id].netScore += points;
    teamTwoObject.members[data.attacker_character_id].deaths++;
    //logging
    console.log(teamTwoObject.members[data.attacker_character_id].name + ' Killed himself ' + points);
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamTwoObject.members[data.attacker_character_id].name,
        winner_faction: teamTwoObject.faction,
        loser: teamTwoObject.members[data.character_id].name,
        loser_faction: teamTwoObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function teamOneTeamkill (data, item) {
    const points = pointMap['21'].points;
    teamOneObject.points += points;
    teamOneObject.netScore += points;
    teamOneObject.deaths++;
    teamOneObject.members[data.attacker_character_id].points += points;
    teamOneObject.members[data.character_id].deaths++;
    //logging
    console.log(teamOneObject.members[data.attacker_character_id].name + ' teamkilled ' + teamOneObject.members[data.character_id].name + ' ' + points);
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamOneObject.members[data.attacker_character_id].name,
        winner_faction: teamOneObject.faction,
        loser: teamOneObject.members[data.character_id].name,
        loser_faction: teamOneObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function teamTwoTeamkill (data, item) {
    const points = pointMap['21'].points;
    teamTwoObject.points += points;
    teamTwoObject.netScore += points;
    teamTwoObject.deaths++;
    teamTwoObject.members[data.attacker_character_id].points += points;
    teamTwoObject.members[data.character_id].deaths++;
    //logging
    console.log(teamTwoObject.members[data.attacker_character_id].name + ' teamkilled ' + teamTwoObject.members[data.character_id].name + ' ' + points);
    console.log(teamOneObject.points + ' ' + teamTwoObject.points);
    //create a JSON and send it to the web
    const obj = {
        winner: teamTwoObject.members[data.attacker_character_id].name,
        winner_faction: teamTwoObject.faction,
        loser: teamTwoObject.members[data.character_id].name,
        loser_faction: teamTwoObject.faction,
        weapon: item.name,
        image: item.image,
        points: points,
        time: 0
    };
    app.killfeedEmit(obj);
    killfeedUpdate(obj);
}

function itsFacilityData(data) {
    //deals with adding points to the correct team
    if (data.new_faction_id !== data.old_faction_id) {
        if (data.outfit_id === teamOneObject.outfit_id) {
            let points = 0;
            if (captures === 0) {
                points = pointMap['0'].points;
                teamOneObject.points += points;
                teamOneObject.netScore += points;
                teamTwoObject.netScore -= points;
                console.log(teamOneObject.name + ' captured the base +' + points);
                console.log(teamOneObject.points + ' ' + teamTwoObject.points);
                app.sendScores(teamOneObject, teamTwoObject);
                killfeedBaseUpdate(teamOneObject.alias, points);
            } else {
                points = pointMap['1'].points;
                teamOneObject.points += points;
                teamOneObject.netScore += points;
                teamTwoObject.netScore -= points;
                console.log(teamOneObject.name + ' captured the base +' + points);
                console.log(teamOneObject.points + ' ' + teamTwoObject.points);
                app.sendScores(teamOneObject, teamTwoObject);
                killfeedBaseUpdate(teamOneObject.alias, points);
            }
            captures++;
        } else if (data.outfit_id === teamTwoObject.outfit_id) {
            let points = 0;
            if (captures === 0) {
                points = pointMap['0'].points;
                teamTwoObject.points += points;
                teamTwoObject.netScore += points;
                teamOneObject.netScore -= points;
                console.log(teamTwoObject.name + ' captured the base +' + points);
                console.log(teamOneObject.points + ' ' + teamTwoObject.points);
                app.sendScores(teamOneObject, teamTwoObject);
                killfeedBaseUpdate(teamTwoObject.alias, points);
            } else {
                points = pointMap['1'].points;
                teamTwoObject.points += points;
                teamTwoObject.netScore += points;
                teamOneObject.netScore -= points;
                console.log(teamTwoObject.name + ' captured the base +' + points);
                console.log(teamOneObject.points + ' ' + teamTwoObject.points);
                app.sendScores(teamOneObject, teamTwoObject);
                killfeedBaseUpdate(teamTwoObject.alias, points);
            }
            captures++;
        }
    }
    //else it was captured by neither outfit
}

function createStream() {
    if (pointMap === 0) { pointMap = thunderdomePointMap; } // default to thunderdome rule set
    const ws = new WebSocket('wss://push.planetside2.com/streaming?environment=ps2&service-id=s:' + api_key.KEY);
    ws.on('open', function open() {
        console.log('stream opened');
        subscribe(ws);
    });
    ws.on('message', function (data) {
        if (data.indexOf("payload") === 2) {
            dealWithTheData(data);
        }
        //store the data somewhere - possibly a txt file in case something gets disputed
    });
    captures = 0;
}

function subscribe(ws) {
    //team1 subscribing
    //{"service":"event","action":"subscribe","characters":["5428010618035589553"],"eventNames":["Death"]}
    teamOne.members.forEach(function (member) {
        ws.send('{"service":"event","action":"subscribe","characters":["' + member.character_id + '"],"eventNames":["Death"]}');
        //console.log('Sent: {"service":"event","action":"subscribe","characters":["' + member.character_id +'"],"eventNames":["Death"]}')
    });
    //team2 subscribing
    teamTwo.members.forEach(function (member) {
        ws.send('{"service":"event","action":"subscribe","characters":["' + member.character_id + '"],"eventNames":["Death"]}');
        //console.log('Sent: {"service":"event","action":"subscribe","characters":["' + member.character_id + '"],"eventNames":["Death"]}');
    });
    //facility Subscribing - subscribes to all capture data
    ws.send('{"service":"event","action":"subscribe","worlds":["1","10","13","17","19","25"],"eventNames":["FacilityControl"]}');
    //start timer
    startTimer(ws);
    console.log('Subscribed to facility and kill/death events between ' + teamOneObject.alias + ' and '  +teamTwoObject.alias);
}

function unsubscribe(ws) {
    //unsubscribes from all events
    ws.send('{"service":"event","action":"clearSubscribe","all":"true"}');
    console.log('Unsubscribed from facility and kill/death events between ' + teamOneObject.alias + ' and '  +teamTwoObject.alias);
}

function startTimer(ws) {
    console.log('timer started');
    roundTracker++;
    timeCounter = 900;
    let time = setInterval(function () {
        if (timeCounter < 1) {
            clearInterval(time);
            unsubscribe(ws);
            final();
            app.matchFinished();
        }
        let sec = parseInt(timeCounter % 60),
            min = parseInt(timeCounter / 60);
        min = min.toString();
        if (min.length < 2) {
            min = '0' + min;
        }
        sec = sec.toString();
        if (sec.length < 2) {
            sec = '0' + sec;
        }
        let timerObj = {
            minutes: min,
            seconds: sec
        };
        let timeString = min + ' : ' + sec;
        fs.writeFile('overlay/time.txt', timeString, function (err) {
            if (err) {
                return console.log('time.txt Error: ' + err);
            }
        });
        app.timerEmit(timerObj);
        timeCounter--;
    }, 1000);
}

function stopTheMatch() {
    timeCounter = 0;
}

function startUp(tOne, tTwo) {
    items.initialise().then(function() {
        time = Date.now();
        console.log(time + ' start match');
        console.log('=====================================================================================================================================');
        teamOne = tOne;
        teamOneObject = teamObject(teamOne);
        teamTwo = tTwo;
        teamTwoObject= teamObject(teamTwo);
        createStream();
        app.refreshPage();
    }).catch(function (err) {
        console.error('Items did not initialise!!');
        console.error(err);
    });
}

function lengthenName(name) {
    if (name.length > 16) {
        name = name.substring(0,15) + ".";
    }
    while (name.length < 16) {
        name += ' ';
    }
    return name;
}

function lengthenStats(stat) {
    while (stat.length < 4) {
        stat = ' ' + stat;
    }
    return stat;
}

function final() {
    const path = 'match' + roundTracker + '.txt';
    console.log(path);
    let teamOneActivePlayers = [];
    for (keys in teamOneObject.members) {
        teamOneActivePlayers.push(teamOneObject.members[keys])
    }
    let teamOneActive = lengthenName(teamOneObject.alias) + '  ' + lengthenStats(teamOneObject.points.toString()) + '  '  + lengthenStats(teamOneObject.netScore.toString()) + '  ' + lengthenStats(teamOneObject.kills.toString())  + '  ' + lengthenStats(teamOneObject.deaths.toString())  + '\n\n';
    teamOneActivePlayers.forEach(function (member) {
        if ((member.points > 0) || (member.netScore !== 0)) {
            const memName = lengthenName(member.name);
            const points = lengthenStats(member.points.toString());
            const netScore = lengthenStats(member.netScore.toString());
            const kills = lengthenStats(member.kills.toString());
            const deaths = lengthenStats(member.deaths.toString());
            teamOneActive += memName + '  ' + points + '  ' + netScore + '  ' + kills + '  ' + deaths + '  ' + '\n';
        }
    });
    let teamTwoPlayers = [];
    for (keys in teamTwoObject.members) {
        teamTwoPlayers.push(teamTwoObject.members[keys])
    }
    let teamTwoActive = lengthenName(teamTwoObject.alias) + '  ' + lengthenStats(teamTwoObject.points.toString()) + '  '  + lengthenStats(teamTwoObject.netScore.toString()) + '  ' + lengthenStats(teamTwoObject.kills.toString())  + '  ' + lengthenStats(teamTwoObject.deaths.toString())  + '\n\n';
    teamTwoPlayers.forEach(function (member) {
        if ((member.points > 0) || (member.netScore !== 0)) {
            const memName = lengthenName(member.name);
            const points = lengthenStats(member.points.toString());
            const netScore = lengthenStats(member.netScore.toString());
            const kills = lengthenStats(member.kills.toString());
            const deaths = lengthenStats(member.deaths.toString());
            teamTwoActive += memName + '  ' + points + '  ' + netScore + '  ' + kills + '  ' + deaths + '  ' + '\n';
        }
    });
    const stats = 'Final Scores for this match:\n\n' + teamOneActive + '\n\n' + teamTwoActive;
    fs.writeFile(path, stats, function(err) {
        if (err) {
            return console.log(path +' Error: ' + err);
        }
        console.log('Match stats wrote to ' + path);
    });
    const teamOneStats = teamOneActive; const path1 = "match" + roundTracker + "TeamOne.txt";
    fs.writeFile(path1, teamOneStats, function(err) {
        if (err) {
            return console.log(path + ' Error: ' + err);
        }
        console.log("Team One stats wrote to " + path1);
    });
    const teamTwoStats = teamTwoActive; const path2 = "match" + roundTracker + "TeamTwo.txt";
    fs.writeFile(path2, teamTwoStats, function(err) {
        if (err) {
            return console.log(path + ' Error: ' + err);
        }
        console.log("Team two stats wrote to " + path2);
    });
}

function adjustScore(t1, t2, reason) {
    if (t1 !== '' && teamOneObject !== undefined) {
        teamOneObject.points += t1;
        let obj = JSON.parse(memberTemplate);
        obj.name = reason;
        obj.points = t1;
        teamOneObject.add(obj);
    }
    if (t2 !== '' && teamTwoObject !== undefined) {
        teamOneObject.points += t2;
        let obj = JSON.parse(memberTemplate);
        obj.name = reason;
        obj.points = t2;
        teamTwoObject.add(obj);
    }
}

exports.startUp        = startUp;
exports.createStream   = createStream;
exports.stopTheMatch   = stopTheMatch;
exports.sendScore      = sendScore;
exports.getPointMaps   = getPointMaps;
exports.updatePointMap = updatePointMap;
exports.individualPointUpdate = individualPointUpdate;
exports.adjustScore    = adjustScore;
