////////////////////////////////////////////////////////////////////
// Networking
/* const https = require('https')
const fs = require('fs')
const options = {
    cert: fs.readFileSync('/etc/letsencrypt/live/aiko.ml/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/aiko.ml/privkey.pem')
} */
var fetch = require('node-fetch')
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// Config
var config = require('./secret.js')
////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////
// Email
const sendmail = require('sendmail')()
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// MongoDB
var mongoose = require('mongoose')
var ObjectId = require('mongoose').Types.ObjectId
var crypto = require('crypto')
var schema = require('./schema.js')
var User = schema.userModel

// mongoose.connect('mongodb://127.0.0.1/ic-date')
mongoose.connect(`mongodb://${config.db.user}:${config.db.pass}@${config.db.url}`)
mongoose.connection.on('error', (e) => {
    console.log("An error occurred while connecting:")
    console.log(e)
    console.log("Please resolve.")
})
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// AWS S3
var AWS = require('aws-sdk')

var s3 = new AWS.S3()
AWS.config.region = 'us-east-1'

var opts = {
    Bucket: 'pimperial-pimps',
    Expires: 60,
    ACL: 'public-read'
}

var upload_url = (c, fn, t, cb) => {
    const n = c + '-' + fn.split('/').reduceRight(_ => _)
    let o = Object.assign({
        Key: n,
        ContentType: t
    }, opts)
    s3.getSignedUrl('putObject', o,
        (e, d) => cb(e ? null : {
            signed: d,
            final: `https://${o.Bucket}.s3.amazonaws.com/${o.Key}`
        }))
}
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// Referrals
var Ref = schema.refModel

var makeRef = (code, cb) => {
    crypto.randomBytes(3, (e, b) => {
        if (e) cb(e, null)
        else Ref.findOne({
            code: code
        }, (e_, rr) => {
            let link = b.toString('hex')
            if (e_) cb(e_, null)
            else if (rr) cb(null, rr.link)
            else Ref.findOne({
                link: link
            }, (e2, ref) => {
                if (e2) cb(e2, null)
                else if (ref) makeRef(code, cb)
                else(new Ref({
                    code: code,
                    link: link,
                    count: 0
                })).save((err) => {
                    if (err) cb(err, null)
                    else cb(null, link)
                })
            })
        })
    })
}

var reffed = (link, cb) => {
    Ref.findOne({
        link: link
    }, (e, ref) => {
        if (e) cb(e)
        else if (ref) {
            ref.count = ref.count + 1
            ref.save((err) => {
                if (err) cb(err)
                else cb(null)
            })
        } else {
            cb("That's not a valid referral link.")
        }
    })
}

var getPos = (code, cb) => {
    Ref.findOne({
        code: code
    }, (e, ref) => {
        if (e) cb(e, null)
        else if (ref) Ref.find({
            count: {
                $gte: ref.count
            }
        }).count((e2, c) => {
            cb(e2, c)
        })
        else cb("Invalid email", null)
    })
}
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// Express
var express = require('express')
app = express()

app.use(require('cors')())
app.use(require('body-parser').json())
app.use(require('helmet')())
app.use(require('express-htaccess-middleware')({
    file: require('path').resolve(__dirname, 'static/.htaccess'),
    verbose: true,
    watch: true
}))
app.use(require('compression')())

app.use('/', express.static(__dirname + '/static'))
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// IC Peeps
var verifyPerson = (code, cb) => {
    crypto.randomBytes(3, (e, b) => {
        if (e) cb(null)
        else {
            let token = b.toString('hex')
            verifyEmail(code, token)
            cb(token)
        }
    })
}

var verifyEmail = (code, token) => {
    sendmail({
        from: 'no-reply@pimperial.now.sh',
        to: `${code}@ic.ac.uk`,
        subject: 'Verify your Email Address for Pimperial',
        html: `Your special token is: <br /><br /><h1>${token}</h1>`,
    }, function (e, p) {
        console.log(e && e.stack)
        console.log(`Sent email to ${code}@ic.ac.uk`)
        console.dir(p)
    })
}

var login = (code, cb) => {
    fetch(`http://cloud-vm-46-180.doc.ic.ac.uk:7022/search?code=${code}`)
        .then((s) => s.json())
        .then((d) => {
            if (d.err) cb(false)
            else User.findOne({
                code: code
            }, (e, s) => {
                if (e) cb(false)
                else if (s) cb(true)
                else(new User({
                    code: code,
                    name: d.name,
                    campus: d.campus,
                    student: d.student,
                    course: d.course,
                    degree: d.degree,
                    email: d.email,
                    bio: d.bio
                })).save((e) => {
                    if (e) cb(false)
                    else cb(true)
                })
            })
        })
        .catch((e) => {
            console.log(e)
            cb(false)
        })
}

var info = (code, cb) => {
    User.findOne({
        code: code
    }, (e, s) => {
        if (e) cb(null)
        else if (s) cb({
            code: s.code,
            name: s.name,
            campus: s.campus,
            student: s.student,
            course: s.course,
            degree: s.degree,
            email: s.email,
            bio: s.bio,
            pics: s.pics
        })
        else cb(null)
    })
}

var bio = (code, b, cb) => {
    User.findOne({
        code: code
    }, (e, s) => {
        if (e) cb(e)
        else if (s) {
            s.bio = b
            console.log(b)
            s.save((e) => cb(e))
        } else cb('User doesn\'t exist!')
    })
}

var pic = (code, fn, t, cb) => {
    User.findOne({
        code: code
    }, (e, s) => {
        if (e) cb(e)
        else if (s) upload_url(code, fn, t,
            (u) => cb(u ? null : 'Couldn\'t save to S3!', u))
        else cb('User doesn\'t exist!', null)
    })
}

var update_pics = (code, pus, cb) => {
    User.findOne({
        code: code
    }, (e, s) => {
        if (e) cb(e)
        else if (s) {
            s.pics = pus
            console.log(pus)
            s.save((e) => cb(e))
        } else cb('User doesn\'t exist!')
    })
}
////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////
// Routes
//////////////////////////////////////
// Verification
app.post('/verify/:code', (q, s) => {
    verifyPerson(q.params.code, (c) => {
        if (c) s.send(c)
        else s.sendStatus(500)
    })
})

app.post('/login/:code', (q, s) => {
    login(q.params.code, (ret) => {
        if (ret) s.sendStatus(200)
        else s.sendStatus(403)
    })
})

app.post('/who/is/:code', (q, s) => {
    info(q.params.code, (i) => {
        if (i) {
            console.log(i)
            s.json(i)
        } else s.sendStatus(403)
    })
})
//////////////////////////////////////
//////////////////////////////////////
// API
app.post('/api/:code/bio', (q, s) => {
    bio(q.params.code, q.body.description, (e) => {
        if (e) s.sendStatus(403)
        else s.sendStatus(200)
    })
})

app.post('/api/:code/propic', (q, s) => {
    pic(q.params.code, q.body.filename, q.body.filetype, (e, u) => {
        if (e) s.sendStatus(403)
        else s.json(u)
    })
})

app.post('/api/:code/pics', (q, s) => {
    update_pics(q.params.code, q.body.pics, (e) => {
        if (e) s.sendStatus(403)
        else s.sendStatus(200)
    })
})
//////////////////////////////////////
//////////////////////////////////////
// Referrals
app.post('/getref', (q, s) => {
    let e = q.query.code
    makeRef(e, (err, link) => {
        if (err) s.sendStatus(500)
        else s.send(link)
    })
})
app.post('/getpos', (q, s) => {
    let e = q.query.code
    getPos(e, (err, count) => {
        if (err) s.sendStatus(500)
        else s.send("" + (count > 20 ? count + 20 : count))
    })
})
app.post('/ref/:link', (q, s) => {
    reffed(q.params.link, (e) => {
        if (e) s.sendStatus(500)
        else s.sendStatus(200)
    })
})
//////////////////////////////////////
////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////
// Start
let port = 3415
app.listen(port, () => console.log(`::${port}`))
// https.createServer(options, app).listen(443)
////////////////////////////////////////////////////////////////////