const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;


app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
