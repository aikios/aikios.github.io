const express = require("express")
const bodyParser = require("body-parser")
const app = express()
const mongoose = require('mongoose');
const fetch = require("node-fetch");
const cors = require('cors')

main().catch(err => console.log(err));

app.use(express.json())
app.use(cors())
async function main() {
    await mongoose.connect('mongodb+srv://mhkhan:khanqueror@cluster0.u8mpr.mongodb.net/myFirstDatabase?retryWrites=true&w=majority')

}

const commentSchema = new mongoose.Schema({
    name: String,
    comment: String,
    post: String
});
const Comment = mongoose.model('Comment', commentSchema);
const tcomment = new Comment({ name: "test", comment: "test", post: "test" });
tcomment.save()
console.log("testcomment published")

app.get("/", async (req, res) => {
    res.send("a")
})

app.get("/comments", async (req, res) => {
    // get published comments from database
    const comments = await Comment.find({ number: req.query.number })
    res.send(comments);
})

app.post("/comment", cors(), async (req, res) => {
    ///write comment to database
    console.log("somebody wants to submit a comment")
    console.log(req.body)
    console.log(req.body.postnumber + " || " + req.body.name + " : " + req.body.comment)
    if (req.body.name != "undefined") {
        if (req.body.comment != "undefined") {
            const ncomment = new Comment({ post: req.body.postnumber, name: req.body.name, comment: req.body.comment });
            await ncomment.save();
            console.log("comment published")
        }
        else {
            console.log("no comment, not publishing")
        }
    } else {
        console.log("no name, not publishing")
    }

})

app.listen(80)
console.log("listening")