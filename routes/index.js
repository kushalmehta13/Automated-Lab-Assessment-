var express = require('express');
var router = express.Router();
var fs = require('fs');
var formidable = require("formidable")
var util = require('util')
var ml = require('ml-sentiment')();
const spawn = require('child_process').spawn;
const database = require('../database.js');
const codeSimilarityCheck = require('../code_similarity_check.js');
const staticCodeAnalysis = require('../static_code_analysis.js');
const mailer = require('../mailer.js');

var session = require('express-session');
router.use(session({secret : '1234'}));

// Connect to RDS
var connection = database.connectToRDS();
connection.connect((err) => {
  if(err) throw err;
  console.log('Connected to DB');
});

// Connect to S3
var Aws = require('aws-sdk');
var s3 = new Aws.S3();
var bucket = 'sourcecodestore';

//compileX
var compiler = require('compilex');
var option = {stats : true};
compiler.init(option);

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/setViva', function(req, res, next) {
  res.render('setViva', { title: 'Express' });
});

router.get('/feedback', function(req, res, next) {
  res.render('feedback', { title: 'Express' });
});

router.get('/code', function(req, res, next) {
  res.render('code', { title: 'Solve'});
});

router.post('/studentDashboard' , function(req, res, next) {
	//Login details are check with DB and then only page is rendered
  const email = req.body.email2;
  const password = req.body.pwd2;
  database.login(connection, email, password, (status) => {
    if(status == 200) res.render('studentDashboard', { title: 'Solve', email : email });
    else res.sendStatus(status);
  });
});

router.post('/feedsubmit' , function(req, res, next) {
  // console.log(req.body.email);
  // console.log(req.body.feedback);
  var feedback = req.body.feedback;
  const email = req.body.email;
  var result = ml.classify(feedback)
  var reply = ""
  console.log(feedback);
  if (result >= 0)
  {
    reply = "We appreciate your feedback."
  }
  else if (result < 0)
  {
    reply = "We would consider the matter. We regret any inconvenience caused"
  }
  console.log(reply)
  //TODO SEND MAIL!!!!!!!!!!!!!
  mailer.sendMail({
    from : '"Automated Lab Assessment" <automatedlabassessment@gmail.com>',
    to : email,
    text : reply
  }, function(data) {
    res.sendStatus(200);
  });
  res.render('studentDashboard', { title: 'Solve'});
});

router.post('/teacherDashboard' , function(req, res, next) {
	//Login details are check with DB and then only page is rendered
	res.render('teacherDashboard', { title: 'Solve' });
});

// Sample get question
router.post('/getQuestion', function(req, res) {
  const q_id = req.body.q_id;
  database.getQuestion(connection, q_id, function(data, status) {
    if(status != 200) res.sendStatus(status);
    s3.getObject({
      Bucket : bucket,
      Key : 'Questions/Ques1.txt'
    }, function(err, data) {
      if(err) throw err;
      res.send({
        "data" : data.Body.toString(),
        "status" : status
      });
    });
  });
});

router.post('/getBadness', function(req, res) {
  const email = req.body.email;
  const q_id = req.body.q_id;
  const filepath = email.split('@')[0] + '/sca' + q_id + '.txt';
  s3.getObject({
    Bucket : bucket,
    Key : filepath
  }, (err, data) => {
    if(err) res.send({
      "data" : null,
      "status" : 500
    });
    else res.send({
      "data" : data.Body.toString(),
      "status" : 200
    });
  });
});

router.get('/analytics', function(req, res) {
  res.render('analytics', {
    bar : 'http://s3-us-east-2.amazonaws.com/sourcecodestore/bar.png',
    box : 'https://s3.us-east-2.amazonaws.com/sourcecodestore/box.png',
    scatter : 'https://s3.us-east-2.amazonaws.com/sourcecodestore/scatter.png'
  });
});

router.post('/compilecode', function(req, res, next) {
  	const code = req.body.code;
    input = req.body.input;
    const inputRadio = req.body.inputRadio;
    const lang = req.body.lang;
    intput = "5 4 3 2 1";
    correct = "1 2 3 4 5";

    // Still not received from client
    const email = req.body.email;
    const q_id = req.body.q_id;
    const filepath = email.split('@')[0] + '/' + q_id + '.cpp';
    const cscpath = email.split('@')[0] + '/csc' + q_id + '.txt';
    const scapath = email.split('@')[0] + '/sca' + q_id + '.txt';

    // Store code in bucket and run similarity check
    s3.putObject({
      Bucket : bucket,
      Key : filepath,
      Body : code
    }, (err, data) => {
      if(err) throw err;
      else console.log(data);
      codeSimilarityCheck.checkSimilarity(filepath, 'Stu_ans/file2.cpp', cscpath);
      staticCodeAnalysis.analyseFile(filepath, './StaticCodeAnalysis/result.txt', scapath, email);
    });

    // Compile code and serve output
    if(inputRadio === "true") {
      var envData = { OS : "linux" , cmd : "gcc"};
      compiler.compileCPPWithInput(envData , code ,input , function (data) {
        compiler.flushSync();
    		if(data.error) res.send(data.error);
    		else {
          res.send(data.output);
        }
    	});
	  }
    else {
    	var envData = { OS : "linux" , cmd : "gcc"};
      compiler.compileCPP(envData, code, function (data) {
        compiler.flushSync();
      	if(data.error) res.send(data.error);
      	else {
          var msg = "";
          var r = data.output.localeCompare(correct);
          if(r != 0) {
            msg = "Failed to pass all test cases";
          }
          else {
            msg = "All test cases passed";
          }
          console.log(msg);
          res.send({'m' : msg, 'code' : code});
        }
      });
    }
});

// session setup


router.get('/pagecounter', function(req, res){
  if(req.session.page_views){
     req.session.page_views++;
     res.send("You visited this page " + req.session.page_views + " times");
  } else {
     req.session.page_views = 1;
     res.send("Welcome to this page for the first time!");
  }
});

//MCQ
router.get('/viva', function(req, res, next) {
  res.render('mcq', { title: 'Solve' });
});


router.get('/questions', function(req, res, next) {
  data = [{
  question: "What is the complexity of quicksort?",
  option_one: "O(nlog n)",
  option_two: "O(n)",
  option_three:"O(n^2)",
  option_four: "O(2n^n)",
  correct: "one"
  },
  {
  question: "What is the time complexity of using quicksort on a linkedlist?",
  option_one: "O(n^2)",
  option_two: "O(n)",
  option_three:"O(n^n)",
  option_four: "O(log n)",
  correct: "one"
},
{
  question: "Does quicksort sort in place?",
  option_one: "Yes",
  option_two: "Depends on values",
  option_three:"No",
  correct: "three"
}]

res.json(data);
});


module.exports = router;
