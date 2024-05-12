const express = require(`express`)
const router = express.Router();
const notesModel = require('../models/notes');
const notes = require('../models/notes');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken")
const userModel = require("../models/users");
const GoogleStrategy = require('passport-google-oidc');
const passport = require('passport');
const { config } = require('dotenv');
const { v4: uuidV4 } = require(`uuid`);

//call the environment varibles set in  env
config();

const secretKey = process.env.JWT_SECRET_KEY;

//passport strategy for goggle authentication


router.get('/login/federated/google', passport.authenticate(`google`));

passport.use(new GoogleStrategy({
    clientID: process.env['GOOGLE_CLIENT_ID'],
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
    callbackURL: '/oauth2/redirect/google',
    scope: ['profile', 'email'],
    passReqToCallback: true // Passes req object to the verify callback
}, async function verify(req, issuer, profile, cb) {
    console.log(profile.emails[0].value)
    let user = await userModel.findOne({ email: profile.emails[0].value });
    if (user) {
        const token = jwt.sign({ email: profile.emails[0].value, userid: user._id },
            secretKey, { algorithm: 'HS256', expiresIn: '1h' }
        );

        // Set token as a cookie using res object from request
        req.res.cookie('token', token, { maxAge: 3600000, httpOnly: true }); // Expires in 1 hour

        return cb(null, user);
    } else {

        const salt = await bcrypt.genSalt(10);
        const password = uuidV4();
        const hashedPassword = await bcrypt.hash(password, salt);
        let newUser = await userModel.create({
            username: profile.displayName,
            email: profile.emails[0].value,
            password: hashedPassword,
        });

        const token = jwt.sign({ email: profile.emails[0].value, userid: newUser._id },
            secretKey, { algorithm: 'HS256', expiresIn: '1h' }
        );

        // Set token as a cookie using res object from request
        req.res.cookie('token', token, { maxAge: 3600000, httpOnly: true }); // Expires in 1 hour

        await newUser.save();
        return cb(null, newUser)
    }
}));


router.get('/oauth2/redirect/google', passport.authenticate('google', {
    successRedirect: '/home',
    failureRedirect: '/login'
}));


router.get("/", async(req, res) => {
    try {
        res.render('index');
    } catch (err) {
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
});


router.get("/login", (req, res) => {
    res.render("login")
})


if (!secretKey) {
    console.error('JWT secret key is missing. Please set it in the environment variables.');
    process.exit(1);
}


router.post("/notely/registeraccount", async(req, res) => {
    try {
        const { username, email, password } = req.body;
        const user = await userModel.findOne({ email });
        if (user) {
            return res.status(409).json({ success: false, message: "User is already registered" });
        }


        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await userModel.create({
            username,
            email,
            password: hashedPassword
        });

        const token = jwt.sign({ email: newUser.email, userid: newUser._id },
            secretKey, { algorithm: 'HS256', expiresIn: '1h' }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.redirect("/home");
    } catch (error) {

        console.error(error);
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
});




router.post("/Notely/login", async(req, res, ) => {
    let { email, password } = req.body
    let user = await userModel.findOne({ email })
    if (!user) return res.status(err.status || 500).json({ success: false, message: "Unable to login,  please try again" })

    bcrypt.compare(password, user.password, function(err, result) {
        if (err) {
            res.status(err.status || 500).json({ success: false, message: err.message })
        } else {
            if (result) {
                let token = jwt.sign({ email: user.email, userid: user._id }, secretKey);
                res.cookie("token", token)
                res.status(401).redirect("/home")

            } else res.status(400).render("loginError");
        }

    });


})




router.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/login")

})



function IsLoggedIn(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ success: false, message: "You must be logged in to access this resource" });
    }

    try {
        const data = jwt.verify(token, secretKey);
        req.user = data;
        next();
    } catch (err) {

        console.error('Token verification error:', err);
        return res.status(401).json({ success: false, message: "Invalid or expired token. Please log in again" });
    }
}



router.get("/home", IsLoggedIn, async(req, res, next) => {

    try {
        const allnotes = await notesModel.find();

        // Format the date for each note without changing the existing `date` property
        allnotes.forEach((note) => {
            let date = note.date;
            let dateObj = new Date(date);

            let monthNames = [
                '', 'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            let day = dateObj.getDate();
            let month = dateObj.getMonth() + 1;
            let year = dateObj.getFullYear();

            let monthName = monthNames[month];
            let formattedDate = `${monthName} ${day}, ${year}`;

            // Assign the formatted date to a new property in each note
            note.formattedDate = formattedDate;
        });
        res.render('home', { allnotes });
    } catch (err) {
        res.status(500).json({ success: false, message: "Something went wrong" });
    }

})



router.get("/mynotes/create/notes", IsLoggedIn, (req, res) => {
    try {
        // Create a Date object representing the current date and time
        const currentDate = new Date();

        // Define an array of month names
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        // Extract the day, month, and year from the Date object
        const day = currentDate.getDate(); // Gets the day of the month (1-31)
        const month = currentDate.getMonth(); // Gets the month (0-11), array is zero-based
        const year = currentDate.getFullYear(); // Gets the full year (e.g., 2024)

        // Extract the time components (hour and minute)
        let hours = currentDate.getHours(); // Gets the hour (0-23)
        const minutes = currentDate.getMinutes(); // Gets the minutes (0-59)

        // Determine whether the time is "am" or "pm" and convert to 12-hour format
        const period = hours >= 12 ? 'pm' : 'am';
        if (hours > 12) {
            hours -= 12;
        } else if (hours === 0) {
            hours = 12;
        }

        // Format the minutes to be two digits (e.g., "05" instead of "5")
        const formattedMinutes = String(minutes).padStart(2, '0');

        // Format the date and time as "25 April 11:55 pm"
        const formattedDate = `${day} ${monthNames[month]} ${hours}:${formattedMinutes} ${period}`;

        console.log(formattedDate); // Output example: "25 April 11:55 pm"

        res.render('notes', { formattedDate })

    } catch (error) {
        res.status(500).json({ success: false, message: "Something went wrong" })
    }
})




router.post("/mynotes/add/notes", IsLoggedIn, async(req, res) => {
    const { title, description } = req.body;

    try {
        const creatednote = await notesModel.create({
            title,
            description
        });
        res.redirect("/home")

    } catch (err) {
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
})


router.get('/mynotes/opennote/:noteId', IsLoggedIn, async(req, res) => {
    try {
        const opennote = await notesModel.findOne({ _id: req.params.noteId });

        let formattedDate;

        let date = opennote.date;
        let dateObj = new Date(date);

        let monthNames = [
            '', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        let day = dateObj.getDate();
        let month = dateObj.getMonth() + 1;
        let year = dateObj.getFullYear();

        let monthName = monthNames[month];
        formattedDate = `${monthName} ${day}, ${year}`;

        res.render("opennote", { opennote, formattedDate });

    } catch (error) {
        res.status(500).json({ success: false, message: "Something went wrong" });

    }
})



router.get("/mynotes/deletenote/:noteId", IsLoggedIn, async(req, res) => {
    try {
        const deletedNote = await notesModel.findByIdAndDelete(req.params.noteId);
        res.redirect("/home");
    } catch (error) {
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
})




router.get("/mynotes/editnote/:noteId", IsLoggedIn, async(req, res) => {
    try {

        const editnote = await notesModel.findOne({ _id: req.params.noteId });

        let formattedDate;

        let date = editnote.date;
        let dateObj = new Date(date);

        let monthNames = [
            '', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        let day = dateObj.getDate();
        let month = dateObj.getMonth() + 1;
        let year = dateObj.getFullYear();

        let monthName = monthNames[month];
        formattedDate = `${monthName} ${day}, ${year}`;

        res.render("editnote", { editnote, formattedDate });

    } catch (error) {
        res.status(500).json({ success: false, message: "Something wen wrong." })
    }

})







router.post("/mynotes/updatenote/:noteId", IsLoggedIn, async(req, res) => {
    try {
        const { title, description } = req.body;
        const existingNote = await notesModel.findById(req.params.noteId);
        if (!existingNote) {
            return res.status(404).json({ success: false, message: "Note not found" });
        }

        const updatedTitle = title ? title : existingNote.title;
        const updatedDescription = description ? `${existingNote.description} \n\n ${description}` : existingNote.description

        const updatedNote = {
            title: updatedTitle,
            description: updatedDescription,
            previousVersions: existingNote.previousVersions ? [...existingNote.previousVersions, {
                title: existingNote.title,
                description: existingNote.description,
                updatedAt: existingNote.updatedAt,
            }] : [],
            updatedAt: Date.now(),
        };

        await notesModel.findByIdAndUpdate(req.params.noteId, updatedNote);
        res.redirect("/home");

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
});



module.exports = router;