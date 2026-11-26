package classifier

import (
	"unicode"
)

const CandyQuestion = `[题目]
不使用任何外部工具回答以下问题：

在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

        苹果味  桃子味  西瓜味
圆形       7      9      8
五角星形   7      6      4

[输出格式]
只输出一行，以 {"ANSWER": <唯一答案>}，为输出格式，将答案填入 ANSWER Key 对应的 Value 中，答案必须为正整数，数字使用 0–9，不加前导零，不要输出空格、单位、解释、代码块或其他内容。
例如输出： {"ANSWER": 10}`

// 格式宽容，但排除更长数字、小数及正负数中的子串。
func MatchesCandy(answer string) bool {
	r := []rune(answer)
	for i := 0; i+1 < len(r); i++ {
		if r[i] != '2' || r[i+1] != '1' {
			continue
		}
		numeric := func(c rune) bool { return unicode.IsDigit(c) || c == '.' || c == '+' || c == '-' }
		if i > 0 && numeric(r[i-1]) {
			continue
		}
		if i+2 < len(r) {
			next := r[i+2]
			if unicode.IsDigit(next) || next == '+' || next == '-' || (next == '.' && i+3 < len(r) && unicode.IsDigit(r[i+3])) {
				continue
			}
		}
		return true
	}
	return false
}
