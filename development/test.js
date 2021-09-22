const mongoose = require('mongoose');

main().catch(err => console.log(err));

async function main() {
    await mongoose.connect('mongodb+srv://mhkhan:khanqueror@cluster0.u8mpr.mongodb.net/myFirstDatabase?retryWrites=true&w=majority')

    const commentSchema = new mongoose.Schema({
        name: String,
        comment: String
    });

    // kittySchema.methods.speak = function speak() {
    //     const greeting = this.name
    //         ? "Meow name is " + this.name
    //         : "I don't have a name";
    //     console.log(greeting);
    // };

    const Comment = mongoose.model('Comment', commentSchema);

    const john = new Comment({ name: 'John Doe', comment: 'No Comment' });
    const pitbull = new Comment({ name: 'Pit Bull', comment: 'Mr. Worldwide' });
    await john.save();
    await pitbull.save();
    const comments = await Comment.find();
    console.log(comments);

    await Comment.find({ name: /^john/ });
}