const express = require("express");

const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require("firebase-admin");
const events = require("./events");

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert('../m-blog-fd54c-firebase-adminsdk-w3eul-8097c7664e.json'),
    databaseURL: "https://m-blog-fd54c.firebaseio.com"
});

//Initialize Express Server
const PORT = 3000;
const app = express();
app.use(cors({
    credentials: true,
    origin: true
}));
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    origins: '*:*'
});

//Initialize Socket IO

io.on("connection", function (socket) {
    socket.on("global", async function (data) {
        const event = data.event;
        console.log(data);
        if (event == events.sendAnswer) {
            const lobbyId = data.lobbyId;
            const questionId = data.questionId;
            const uid = data.uid;
            const answer = data.answer;

            let lobby = admin.firestore().collection("lobby").doc(lobbyId)
            let lobbyData = await lobby.get();
            if (lobbyData.exists) {
                let user = lobby.collection("participants").doc(uid);
                let userData = await user.get();
                if (userData.exists) {
                    let nickname = userData.data().nickname;
                    lobby.collection("questions").doc(questionId).collection("answers").doc(uid).set({
                        questionId: questionId,
                        answer: answer,
                        nickname: nickname
                    });
                }

            }
        } else if (event == events.sendQuestionResult) {
            const lobbyId = data.lobbyId;
            const questionId = data.data.questionId;
            let question = admin.firestore().collection("lobby").doc(lobbyId)
                .collection("questions").doc(questionId);
            let questionData = await question.get();
            if (questionData.exists) {
                let users = (await question.collection("answers").get()).docs;
                for (let user of users) {
                    socket.broadcast.emit(user.id, {
                        event: events.questionResult,
                        questionId: questionId,
                        data: questionData.data()
                    });
                }
            }
        } else if (event == events.sendStartStreaming) {
            const lobbyId = data.lobbyId;
            const uid = data.uid;
            let lobby = admin.firestore().collection("lobby").doc(lobbyId);
            let lobbyData = await lobby.get();
            if (lobbyData.exists) {
                if (lobbyData.data().ownerId == uid) {
                    let usrs = await lobby.collection("participants").listDocuments();
                    for (let usr of usrs) {
                        usr.delete();
                    }
                }
            }
        } else if (event == events.joinLobby) {
            const lobbyId = data.lobbyId;
            const uid = data.uid;
            const nickname = data.nickname;
            let lobby = admin.firestore().collection("lobby").doc(lobbyId)
            let lobbyData = await lobby.get();
            if (lobbyData.exists) {
                lobby.collection("participants").doc(uid).set({
                    nickname: nickname
                });
                socket.emit(uid, {
                    event: events.acceptJoin
                });
            } else {
                socket.emit(uid, {
                    event: events.rejectJoin
                });
            }
        } else if (event == events.sendStartGame) {
            const lobbyId = data.lobbyId;
            let participants = admin.firestore().collection("lobby").doc(lobbyId)
                .collection("participants");
            let participantsData = await participants.get();
            for (let user of participantsData.docs) {
                let uid = user.id;
                socket.broadcast.emit(uid, {
                    event: events.startGame
                });
            }
        } else if (event == events.sendQuestion) {
            const lobbyId = data.lobbyId;
            let participants = admin.firestore().collection("lobby").doc(lobbyId)
                .collection("participants");
            let participantsData = await participants.get();
            for (let user of participantsData.docs) {
                let uid = user.id;
                socket.broadcast.emit(uid, {
                    event: events.question,
                    question: {
                        lobbyId: lobbyId,
                        ...data.question
                    }
                });
            }
        } else if (event == events.sendLeaderboard) {
            const lobbyId = data.lobbyId;
            let leaderboard = [];
            let lobby = admin.firestore().collection("lobby").doc(lobbyId)
            let participants = lobby.collection("participants");
            let participantsData = await participants.get();
            let questions = lobby.collection("questions");
            let questionsData = await questions.get();
            for (let quest of questionsData.docs) {
                let qid = quest.id;
                let answers = questions.doc(qid).collection("answers");
                let answersData = await answers.get();
                for (let answer of answersData.docs) {
                    updateLeaderboard(leaderboard, answer.id, quest.data(), answer.data());
                }
            }
            console.log(leaderboard);
            leaderboard = leaderboard.sort((u1, u2) => u1.correct < u2.correct);
            for (let user of participantsData.docs) {
                let uid = user.id;
                socket.broadcast.emit(uid, {
                    event: events.leaderboard,
                    leaderboard: leaderboard
                });
            }
        }
    })
});


function updateLeaderboard(leaderboard, uid, question, answer) {
    if (leaderboard.filter(rec => rec.uid == uid).length == 0) {
        leaderboard.push({
            uid: uid,
            nickname: answer.nickname,
            correct: 0
        });
    }
    if (question.correctAnswer == answer.answer) {
        leaderboard.filter(rec => rec.uid == uid)[0].correct++;
    }
}


app.use(bodyParser());
app.use(cors());

app.post("/lobby", async (req, res) => {
    const {
        uid,
        name
    } = req.body;

    try {
        const lobbyId = Math.random().toString().substr(2, 6);
        await admin.firestore().collection("lobby").doc(lobbyId).set({
            ownerId: uid,
            name: name,
            id: lobbyId,
            questions: {},
        });
        res.send({
            lobbyId: lobbyId
        });
    } catch (err) {
        res.send({
            error: err
        });
    }
});

app.post("/lobby/clearResult", async (req, res) => {
    const {
        uid,
        lobbyId,
        questionId
    } = req.body;
    try {
        console.log(req.body);
        let lobby = admin.firestore().collection("lobby").doc(lobbyId);
        let lobbyData = await lobby.get();
        if (lobbyData.exists) {
            if (lobbyData.data().ownerId == uid) {
                let results = await lobby.collection("questions").doc(questionId)
                    .collection("answers").listDocuments();
                console.log(results);
                for (let result of results) {
                    console.log(result);
                    result.delete();
                }
            }
        }
        res.status(200).send({
            message: "OK"
        });
    } catch (err) {
        res.status(401).send({
            message: "Failed"
        });
    }
});

app.post("/lobby/questions", async (req, res) => {
    const {
        uid,
        lobbyId,
        question,
        answerA,
        answerB,
        answerC,
        answerD,
        correctAnswer,
        timeout
    } = req.body;

    try {
        let lobby = await admin.firestore().collection("lobby").doc(lobbyId).get();
        let data = lobby.data();
        console.log(data);
        if (data.ownerId == uid) {
            lobby.ref.collection("questions").add({
                question: question,
                answerA: answerA,
                answerB: answerB,
                answerC: answerC,
                answerD: answerD,
                correctAnswer: correctAnswer,
                timeout: timeout
            });
            res.send({
                status: "Created"
            });
        } else {
            res.send({
                error: "Permission denied"
            });
        }
    } catch (err) {
        res.send({
            error: err
        });
    }
});

app.post("/lobby/run", async (req, res) => {
    const {
        uid,
        lobbyId
    } = req.body;
    try {
        let lobby = await admin.firestore().collection("lobby").doc(lobbyId).get();
        let data = lobby.data();
        if (data.ownerId == uid) {
            io.on('connection', function (socket) {
                socket.emit(data.id, JSON.stringify({
                    status: "Start"
                }));
                socket.on(data.id, async function (msg) {
                    let client = JSON.parse(msg);
                    try {
                        if (client.status == "Client Result") {
                            const {
                                clientId,
                                qid,
                                answer
                            } = client;
                            let question = await lobby.ref.collection("questions").doc(qid).get();
                            let qData = question.data();
                            question.ref.collection("results").doc(clientId).set({
                                id: clientId,
                                answer: answer,
                                isCorrect: (qData.correctAnswer == answer)
                            });
                        }
                    } catch (err) {
                        console.log(err);
                    }
                });
            });
            res.send({
                status: "Started"
            });
        } else {
            res.send({
                status: "Permission denied"
            });
        }
    } catch (err) {
        res.send({
            error: err
        });
    }
});

app.post("/lobby/sendQuestion", async (req, res) => {
    const {
        uid,
        lobbyId,
        qid
    } = req.body;
    try {
        let lobby = await admin.firestore().collection("lobby").doc(lobbyId).get();
        let data = lobby.data();
        if (data.ownerId == uid) {
            let question = await lobby.ref.collection("questions").doc(qid).get();
            let qData = question.data();
            io.on('connection', function (socket) {
                socket.emit(data.id, JSON.stringify({
                    status: "Send Question",
                    payload: {
                        qid: qid,
                        question: qData.question,
                        answerA: qData.answerA,
                        answerB: qData.answerB,
                        answerC: qData.answerC,
                        answerD: qData.answerD,
                        timeout: qData.timeout
                    }
                }));
            });
            res.send({
                status: "Done"
            });
        }
    } catch (err) {
        res.send({
            error: err
        });
    }
});


app.post("/lobby/sendResult", async (req, res) => {
    const {
        uid,
        lobbyId,
        qid
    } = req.body;
    try {
        let lobby = await admin.firestore().collection("lobby").doc(lobbyId).get();
        let data = lobby.data();
        if (data.ownerId == uid) {
            let question = await lobby.ref.collection("questions").doc(qid).get();
            let qData = question.data();
            io.on('connection', function (socket) {
                socket.emit(data.id, JSON.stringify({
                    status: "Question Result",
                    payload: {
                        qid: qid,
                        correctAnswer: qData.correctAnswer
                    }
                }));
            });
            res.send({
                status: "Done"
            });
        }
    } catch (err) {
        res.send({
            error: err
        });
    }
});


http.listen(PORT, () => {
    console.log("Server is running");
})