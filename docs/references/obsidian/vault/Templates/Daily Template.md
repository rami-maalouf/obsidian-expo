<%* var fileDate = moment(tp.file.title,'YYYY-MM-DD');let prevDay = moment(fileDate).subtract(1, 'd').format('YYYY-MM-DD'); let nextDay = moment(fileDate).add(1, 'd').format('YYYY-MM-DD'); let weekLink = fileDate.format('YYYY-[W]WW'); -%>
---
tags:
  - reviews/daily
Created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
Headings:
  - "[[<%tp.file.title%>#Improvements|Improvements]] [[<%tp.file.title%>#Obstacles|Obstacles]]"
  - "[[<%tp.file.title%>#Accomplishments|Accomplishments]]"
Parent: "[[Weekly/<% weekLink %>|<% weekLink %>]]"
Dreams:
Summary:
Intention:
Discipline:
Focus:
Courage:
Purpose:
Energy:
Communication:
Uniqueness:
Rating:

---
## Reminders

**Today's Big 3**
1.
2.
3.

Remember ![[<% prevDay %>#Improvements]]
## Journals

- [ ] **3 things I'm grateful for in my life & about myself
- [ ] mentally planned out how to achieve my top 5 habits
### Morning Mindset

**I'm excited today for:**

**One word to describe the person I want to be today would be __ because:**

**Someone who needs me on my a-game/needs my help today is:**

**What's a potential obstacle/stressful situation for today and how would my best self deal with it?**

**Someone I could surprise with a note, gift, or sign of appreciation is:**

**One action I could take today to demonstrate excellence or real value is:**

**One bold/uncomfortable action I could take today is:**

**An overseeing high performance coach would tell me today that:**

**What would I do if I knew I wouldn't fail**

**What is the goal?**

**What is the bottleneck?**

**I know today would be successful if I did or felt this by the end:**

## Reflection
### Accomplishments
%% what did i get done today that i would like to remember for the rest of my life? %%

#### what did I control?

### Obstacles
%% what was an obstacle i faced, how did i deal with it, and what can i learn from for the future? %%

#### was there a situation where I went against my moral compass?

### Improvements
%% what can i do tomorrow to be 1% better? how can i increase my ratings? %%

#### Communication
%% what went well? what didn't go well? %%

## Today's Notes

```dataview
TABLE file.tags as "Note Type", Created
from ""
WHERE contains(dateformat(Created, "yyyy-MM-dd"), this.file.name)
SORT file.name
```
