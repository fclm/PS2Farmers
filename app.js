const express       = require('express'),
    path          = require('path'),
    favicon       = require('serve-favicon'),
    logger        = require('morgan'),
    cookieParser  = require('cookie-parser'),
    bodyParser    = require('body-parser'),
    http          = require('http');

const ps2ws         = require('./ps2ws.js'),
    teams         = require('./teams.js'),
    items         = require('./items.js'),
    routes        = require('./routes/index.js'),
    adminControls = require('./routes/admin.js'),
    rules         = require('./routes/rules.js'),
    api_key       = require('./api_key.js'),
    password      = require('./password.js');

//global variable for use in different functions
let teamOneObject, teamTwoObject;
// running variable stores the state of a match (true means a match is in progress) and is used to prevent multiple streams being opened for the same data.
// should prevent the double tracking issues of round 2 of thunderdome.
let running = false;
const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', '.hbs');
app.use(express.static(__dirname + '/public'));

app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/admin', adminControls);
app.use('/rules', rules);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

app.set('port', 3001);

// Render main html
app.get('/', function(req, res) {
    res.render('killfeed', {title: 'Killfeed'});
});

async function start(one, two) {
    teamOneObject = await teams.fetchTeamData(one);
    teamTwoObject = await teams.fetchTeamData(two);

    console.log('T1 - ' + JSON.stringify(teamOneObject));
    console.log('T2 - ' + JSON.stringify(teamTwoObject));

    ps2ws.startUp(teamOneObject, teamTwoObject);
    running = true;
}

console.log('Starting server...');
const server = http.createServer(app).listen(app.get('port'));
const io = require('socket.io').listen(server);
io.on('connection', function(sock) {
    sock.on('backchat', function () {
        if (teamOneObject !== undefined) {
            const teams = {
                teamOne: {
                    alias: teamOneObject.alias,
                    name: teamOneObject.name,
                    faction: teamOneObject.faction
                },
                teamTwo: {
                    alias: teamTwoObject.alias,
                    name: teamTwoObject.name,
                    faction: teamTwoObject.faction
                }
            };
            io.emit('teams', {obj: teams});
            ps2ws.sendScore();
        } else {
            console.log(teamOneObject + '\n' + teamTwoObject);
        }
    });
    sock.on('start', function (data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY) {
            if ((event.hasOwnProperty('teamOne')) && (event.hasOwnProperty('teamTwo'))) {
                if (running !== true) {
                    start(event.teamOne, event.teamTwo).then(function () {
                        console.log('Admin entered a start match command involving: ' + event.teamOne + ' ' + event.teamTwo);
                    }).catch(function (err) {
                        console.error("Failed to start match between " + event.teamOne + ' ' + event.teamTwo);
                        console.error(err);
                    });
                }
                else {
                    console.error('Admin entered a start match command involving: ' + event.teamOne + ' ' + event.teamTwo + ' But a match is already running');
                }
            } else {
                console.error('No data sent: ' + event.teamOne + ' ' + event.teamTwo);
            }
        }
    });
    sock.on('newRound', function(data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY) {
            if (running !== true) {
                console.log('Admin entered New Round command, new round starting: ');
                console.log(data);
                ps2ws.createStream();
                running = true;
            }
            else {
                console.error('Admin entered New Round command, but a match is already running');
            }
        } else {
            console.log(data);
        }
    });
    sock.on('stop', function(data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY) {
            console.log('Admin entered Stop command, match stopping: ');
            console.log(data);
            ps2ws.stopTheMatch();
        }
    });
    sock.on('adjust', function(data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY) {
            console.log('Admin adjusted score: ');
            console.log(data);
            ps2ws.adjustScore(event.t1, event.t2, event.reason);
        }
    });
    sock.on('weaponDefault',function (data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY && running === false) {
            if (event.ruleset === "weaponThunderdome") { items.updateCategoryMap(0); }
            if (event.ruleset === "weaponEmerald") { items.updateCategoryMap(1); }
            if (event.ruleset === "weaponOvO") { items.updateCategoryMap(2); }
            console.log('Admin set default weapon rules: ');
            console.log(data);
        }
    });
    sock.on('classDefault', function (data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY && running === false) {
            if (event.ruleset === "classThunderdome") { ps2ws.updatePointMap(0);}
            if (event.ruleset === "classEmerald") { ps2ws.updatePointMap(1); }
            if (event.ruleset === "classOvO") { ps2ws.updatePointMap(2); }
            console.log('Admin set default class rules: ');
            console.log(data);
        }
    });
    sock.on('weaponUpdate', function(data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY && running === false) {
            console.log('Admin updated weapon rules');
            console.log(data);
            items.individualCategoryUpdate(event);
        }
    });
    sock.on('classUpdate', function(data) {
        io.emit('redirect');
        const event = data.obj;
        if (event.auth === password.KEY && running === false) {
            console.log('Admin updated class rules: ');
            console.log(data);
            ps2ws.individualPointUpdate(event);
        }
    });
});

function matchFinished() {
    // called from ps2ws when a match is finished
    running = false;
}

console.log('Listening on port %d', server.address().port);

function refreshPage() {
    io.emit('refresh');
}

function killfeedEmit(killfeed) {
    io.emit('killfeed', {obj: killfeed});
}

function sendScores(teamOneObject, teamTwoObject) {
    let scoreboard = {
        teamOne: {
            alias : teamOneObject.alias,
            name : teamOneObject.name,
            points : teamOneObject.points,
            netScore : teamOneObject.netScore,
            kills : teamOneObject.kills,
            deaths : teamOneObject.deaths,
            faction : teamOneObject.faction,
            members : []
        },
        teamTwo: {
            alias : teamTwoObject.alias,
            name : teamTwoObject.name,
            points : teamTwoObject.points,
            netScore : teamTwoObject.netScore,
            kills : teamTwoObject.kills,
            deaths : teamTwoObject.deaths,
            faction : teamTwoObject.faction,
            members : []
        }
    };
    for (keys in teamOneObject.members) {
        scoreboard.teamOne.members.push(teamOneObject.members[keys])
    }
    for (keys in teamTwoObject.members) {
        scoreboard.teamTwo.members.push(teamTwoObject.members[keys])
    }
    io.emit('score', {obj: scoreboard});
}

function playerDataT1 (obj) {
    io.emit('playerDataT1', {obj: obj});
}

function playerDataT2 (obj) {
    io.emit('playerDataT2', {obj: obj});
}

function timerEmit (obj) {
    io.emit('time', {obj: obj});
}

module.exports        = app;
exports.killfeedEmit  = killfeedEmit;
exports.sendScores    = sendScores;
exports.refreshPage   = refreshPage;
exports.playerDataT1  = playerDataT1;
exports.playerDataT2  = playerDataT2;
exports.timerEmit     = timerEmit;
exports.matchFinished = matchFinished;
