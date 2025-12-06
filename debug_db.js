const mongoose = require('mongoose');
const Class = require('./models/Class');
const Teacher = require('./models/Teacher');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/school-db').then(async () => {
    console.log('Connected');
    try {
        const classes = await Class.find({}).populate('classTeacher').populate('subjects.teachers');
        console.log('ALL CLASSES:');
        classes.forEach(c => {
            console.log(`Class: ${c.name}`);
            console.log(`  Class Teacher: ${c.classTeacher ? c.classTeacher.firstName + ' ' + c.classTeacher.lastName : 'None'}`);
            console.log(`  Subjects:`);
            c.subjects.forEach(s => {
                const tNames = s.teachers.map(t => t.firstName).join(', ');
                console.log(`    ${s.name}: [${tNames}]`);
            });
            console.log('---');
        });
    } catch(e) { console.error(e); }
    process.exit();
});
